// Pravidla pro /api/r2-presign (LoRA a modely v R2). Čistá logika bez I/O, aby šla testovat:
// které buckety, klíče a délky platnosti server ochotně podepíše. Samotné ověření přihlášení
// (token sdílený s Databankou) řeší handler.

const DEFAULT_EXPIRES = 3600;
const MIN_EXPIRES = 60;
const MAX_GET_EXPIRES = 24 * 3600;
const MAX_PUT_EXPIRES = 15 * 60;
const MAX_KEY_LENGTH = 512;

const ALLOWED_EXTENSIONS = new Set([
  'safetensors', 'ckpt', 'pt', 'pth', 'bin', 'gguf', 'onnx', 'json', 'yaml', 'txt', 'png', 'jpg', 'jpeg', 'webp',
]);
const KEY_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._\- ()/]*$/u;

function parseList(raw, fallback) {
  const items = String(raw ?? fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items;
}

/** Např. `loras:loras/,models:models/` -> { loras: ['loras/'], models: ['models/'] }. Bucket bez záznamu nemá omezení předpony. */
function parsePrefixes(raw) {
  const map = {};
  for (const entry of parseList(raw, 'loras:loras/')) {
    const idx = entry.indexOf(':');
    if (idx <= 0) continue;
    const bucket = entry.slice(0, idx).trim();
    const prefix = entry.slice(idx + 1).trim();
    if (!bucket) continue;
    (map[bucket] ||= []).push(prefix);
  }
  return map;
}

function policyFromEnv(env = process.env) {
  return {
    allowedBuckets: new Set(parseList(env.R2_ALLOWED_BUCKETS, 'loras,models')),
    defaultBucket: String(env.R2_BUCKET || 'loras').trim(),
    // Soukromý bucket Databanky se tímto endpointem nikdy nepodepisuje.
    blockedBucket: String(env.BANK_BUCKET || 'bank').trim(),
    prefixes: parsePrefixes(env.R2_ALLOWED_KEY_PREFIXES),
    allowPut: /^(1|true|yes)$/i.test(String(env.R2_PRESIGN_ALLOW_PUT || '').trim()),
  };
}

/** Vrací text chyby, nebo null, když je klíč bezpečný. */
function keyProblem(key) {
  if (!key) return 'Missing key';
  if (key.length > MAX_KEY_LENGTH) return 'Key too long';
  if (!KEY_PATTERN.test(key)) return 'Invalid key';
  const segments = key.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return 'Invalid key';
  const name = segments[segments.length - 1];
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || !ALLOWED_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())) return 'Key extension not allowed';
  return null;
}

/** Vrací `{ error, status, extra? }`, nebo `{ op, bucket, key, expires }`. */
function validatePresignRequest(body, policy) {
  const op = String(body?.op || '').toLowerCase();
  if (op !== 'get' && op !== 'put') return { status: 400, error: 'Invalid op (get|put)' };
  if (op === 'put' && !policy.allowPut) return { status: 403, error: 'PUT is disabled' };

  const key = String(body?.key || '').replace(/^\/+/, '').trim();
  const problem = keyProblem(key);
  if (problem) return { status: 400, error: problem };

  const bucket = String(body?.bucket || '').trim() || policy.defaultBucket;
  if (bucket === policy.blockedBucket || !policy.allowedBuckets.has(bucket)) {
    return { status: 400, error: 'Bucket not allowed', extra: { allowed: Array.from(policy.allowedBuckets).filter((b) => b !== policy.blockedBucket) } };
  }

  const prefixes = policy.prefixes[bucket];
  if (prefixes && !prefixes.some((p) => key.startsWith(p))) return { status: 400, error: 'Key prefix not allowed' };

  const requested = Number(body?.expires);
  const max = op === 'put' ? MAX_PUT_EXPIRES : MAX_GET_EXPIRES;
  const expires = Math.max(MIN_EXPIRES, Math.min(max, Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : DEFAULT_EXPIRES));
  return { op, bucket, key, expires };
}

module.exports = {
  DEFAULT_EXPIRES,
  MAX_GET_EXPIRES,
  MAX_PUT_EXPIRES,
  parsePrefixes,
  policyFromEnv,
  keyProblem,
  validatePresignRequest,
};
