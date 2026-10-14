// Jádro serverové části Databanky (Cloudflare R2). Čistá logika bez I/O, aby šla testovat:
// přihlašovací token, kontrola hesla, generování a validace klíčů objektů, podpis S3 (SigV4) odkazů.
// Klient nikdy neposílá vlastní klíč objektu; klíče vždy vzniknou tady a jen v povolených předponách.

const crypto = require('crypto');

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30;

/** Povolené typy nahrávaných obrázků a přípona, pod kterou se uloží. */
const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const KEY_PATTERN = /^(items|thumbs)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif)$/;
const INDEX_KEY = 'index.json';

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function hmacHex(secret, message) {
  return crypto.createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}

function signToken(secret, now = Date.now(), ttlMs = TOKEN_TTL_MS) {
  const exp = now + ttlMs;
  const payload = b64url(JSON.stringify({ exp }));
  return { token: `${payload}.${hmacHex(secret, payload)}`, expiresAt: exp };
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a), 'utf8').digest();
  const hb = crypto.createHash('sha256').update(String(b), 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

function verifyToken(secret, token, now = Date.now()) {
  if (!secret || typeof token !== 'string') return false;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return false;
  if (!safeEqual(signature, hmacHex(secret, payload))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isFinite(exp) && exp > now;
  } catch {
    return false;
  }
}

/** Heslo porovnáváme v konstantním čase; prázdné očekávané heslo nikdy nesouhlasí. */
function checkPassphrase(input, expected) {
  if (!expected || typeof input !== 'string' || input.length === 0) return false;
  return safeEqual(input, expected);
}

function bearerToken(headers) {
  const raw = String((headers && (headers.authorization || headers.Authorization)) || '');
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function isBankKey(key) {
  return typeof key === 'string' && KEY_PATTERN.test(key);
}

function newObjectKeys(contentType, makeId = () => crypto.randomUUID()) {
  const ext = IMAGE_TYPES[contentType];
  if (!ext) return null;
  const id = makeId();
  return { id, itemKey: `items/${id}.${ext}`, thumbKey: `thumbs/${id}.jpg` };
}

function toAmzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function encodeRfc3986(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sha256Hex(message) {
  return crypto.createHash('sha256').update(message, 'utf8').digest('hex');
}

function hmacBuf(key, message) {
  return crypto.createHmac('sha256', key).update(message, 'utf8').digest();
}

/**
 * Předpodepsaný odkaz na objekt v R2. Pokud je zadaný `contentType`, je součástí podpisu,
 * takže nahrání jiného typu, než server povolil, R2 odmítne.
 */
function presignObject({ method, accountId, bucket, key, accessKeyId, secretAccessKey, expires = 3600, contentType, query: extraQuery = {}, now = new Date() }) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const region = 'auto';
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/s3/aws4_request`;

  const headers = contentType ? { 'content-type': contentType, host } : { host };
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join('');

  const query = {
    ...extraQuery,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': signedHeaders,
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((name) => `${encodeRfc3986(name)}=${encodeRfc3986(query[name])}`)
    .join('&');

  const canonicalUri = `/${encodeRfc3986(bucket)}/${key.split('/').map(encodeRfc3986).join('/')}`;
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const kDate = hmacBuf(`AWS4${secretAccessKey}`, dateStamp);
  const kSigning = hmacBuf(hmacBuf(hmacBuf(kDate, region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/**
 * Podpis v hlavičce (SigV4 `Authorization`). R2 ho vyžaduje u operací na úrovni bucketu
 * (výpis, CORS, vytvoření), kde předpodepsaný odkaz nefunguje.
 */
function signedRequest({ method, accountId, accessKeyId, secretAccessKey, path, query = {}, body = '', contentType, extraHeaders = {}, now = new Date() }) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const region = 'auto';
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const payloadHash = sha256Hex(body);

  const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...extraHeaders };
  if (contentType) headers['content-type'] = contentType;
  const names = Object.keys(headers).map((n) => n.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([n, v]) => [n.toLowerCase(), String(v).trim()]));
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((n) => `${encodeRfc3986(n)}=${encodeRfc3986(String(query[n]))}`)
    .join('&');
  const canonicalUri = path.split('/').map((seg, i) => (i === 0 ? seg : encodeRfc3986(seg))).join('/');
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmacBuf(`AWS4${secretAccessKey}`, dateStamp);
  const kSigning = hmacBuf(hmacBuf(hmacBuf(kDate, region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const outHeaders = {};
  for (const [name, value] of Object.entries(headers)) if (name.toLowerCase() !== 'host') outHeaders[name] = value;
  outHeaders.Authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const url = `https://${host}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ''}`;
  return { url, headers: outHeaders };
}

const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const MAX_ITEMS = 50000;

/** Vrací text chyby, nebo null, když je index v pořádku. */
function validateIndex(index) {
  if (!index || typeof index !== 'object' || Array.isArray(index)) return 'Index není objekt.';
  if (index.version !== 1) return 'Nepodporovaná verze indexu.';
  if (!Number.isInteger(index.rev) || index.rev < 0) return 'Neplatná revize indexu.';
  if (!Array.isArray(index.folders) || !Array.isArray(index.items)) return 'Index musí mít složky i položky.';
  if (index.items.length > MAX_ITEMS) return 'Příliš mnoho položek.';
  for (const item of index.items) {
    if (!item || typeof item.id !== 'string') return 'Položka bez id.';
    if (item.itemKey !== undefined && !isBankKey(item.itemKey)) return 'Položka má neplatný klíč.';
    if (item.thumbKey !== undefined && !isBankKey(item.thumbKey)) return 'Položka má neplatný klíč náhledu.';
  }
  if (Buffer.byteLength(JSON.stringify(index), 'utf8') > MAX_INDEX_BYTES) return 'Index je příliš velký.';
  return null;
}

module.exports = {
  TOKEN_TTL_MS,
  IMAGE_TYPES,
  INDEX_KEY,
  signToken,
  verifyToken,
  checkPassphrase,
  bearerToken,
  isBankKey,
  newObjectKeys,
  presignObject,
  signedRequest,
  validateIndex,
};
