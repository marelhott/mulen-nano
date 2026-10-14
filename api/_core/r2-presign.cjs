const crypto = require('crypto');
const bankCore = require('../../utils/bankServerCore.cjs');
const policyCore = require('../../utils/r2PresignPolicy.cjs');

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

function json(statusCode, payload) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(payload) };
}

function env(name) {
  const v = String(process.env[name] || '').trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function toAmzDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

function toDateStamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate());
}

function hmac(key, msg) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest();
}

function sha256Hex(msg) {
  return crypto.createHash('sha256').update(msg, 'utf8').digest('hex');
}

function encodeRfc3986(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalQuery(params) {
  const keys = Object.keys(params).sort();
  return keys
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(String(params[k]))}`)
    .join('&');
}

function getSigningKey(secretAccessKey, dateStamp, region, service) {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

function presignUrl({ method, host, canonicalUri, accessKeyId, secretAccessKey, region, expires }) {
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = toDateStamp(now);
  const algorithm = 'AWS4-HMAC-SHA256';
  const service = 's3';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const query = {
    'X-Amz-Algorithm': algorithm,
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };

  const canonicalQueryString = canonicalQuery(query);
  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';
  const payloadHash = 'UNSIGNED-PAYLOAD';
  const canonicalRequest = [method, canonicalUri, canonicalQueryString, canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const stringToSign = [algorithm, amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = getSigningKey(secretAccessKey, dateStamp, region, service);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  const finalQuery = `${canonicalQueryString}&X-Amz-Signature=${signature}`;
  return `https://${host}${canonicalUri}?${finalQuery}`;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    // Stejný přihlašovací token jako Databanka (BANK_PASSPHRASE / BANK_TOKEN_SECRET).
    const tokenSecret = String(process.env.BANK_TOKEN_SECRET || '').trim();
    if (!tokenSecret) return json(503, { error: 'Přístup k R2 není nakonfigurovaný (chybí BANK_TOKEN_SECRET).' });
    if (!bankCore.verifyToken(tokenSecret, bankCore.bearerToken(event.headers))) {
      return json(401, { error: 'Přihlášení vypršelo nebo chybí.' });
    }

    let body = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return json(400, { error: 'Invalid JSON body' });
    }

    const checked = policyCore.validatePresignRequest(body, policyCore.policyFromEnv());
    if (checked.error) return json(checked.status, { error: checked.error, ...(checked.extra || {}) });
    const { op, bucket, key, expires } = checked;

    const accountId = env('R2_ACCOUNT_ID');
    const accessKeyId = env('R2_ACCESS_KEY_ID');
    const secretAccessKey = env('R2_SECRET_ACCESS_KEY');
    const region = 'auto';
    const host = `${accountId}.r2.cloudflarestorage.com`;

    const canonicalUri = `/${encodeRfc3986(bucket)}/${key.split('/').map(encodeRfc3986).join('/')}`;
    const method = op === 'put' ? 'PUT' : 'GET';
    const signedUrl = presignUrl({ method, host, canonicalUri, accessKeyId, secretAccessKey, region, expires });

    // This is the unsigned path-style URL. It may or may not be publicly readable depending on bucket settings.
    const objectUrl = `https://${host}/${bucket}/${key}`;

    return json(200, { signedUrl, objectUrl, bucket, key, expires });
  } catch (err) {
    return json(500, { error: 'r2 presign failed', detail: String(err?.message || err) });
  }
};
