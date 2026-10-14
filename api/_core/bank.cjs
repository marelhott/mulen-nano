// Databanka: soukromé úložiště nápadů a obrázků v Cloudflare R2.
// Obrázky jdou z prohlížeče přímo do R2 přes předpodepsaný odkaz (server je nepřijímá), metadata
// (složky, štítky, poznámky) jsou v jednom `index.json` v tomtéž bucketu. Přístup chrání heslo
// z prostředí a podepsaný token; klíče objektů vytváří výhradně server.

const core = require('../../utils/bankServerCore.cjs');

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const DOWNLOAD_EXPIRES = 3600;
const UPLOAD_EXPIRES = 900;
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
const MAX_KEYS_PER_CALL = 200;
const FAILED_LOGIN_DELAY_MS = 1200;

function json(statusCode, payload) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(payload) };
}

function config() {
  const get = (name) => String(process.env[name] || '').trim();
  const cfg = {
    accountId: get('R2_ACCOUNT_ID'),
    accessKeyId: get('R2_ACCESS_KEY_ID'),
    secretAccessKey: get('R2_SECRET_ACCESS_KEY'),
    bucket: get('BANK_BUCKET') || 'bank',
    passphrase: get('BANK_PASSPHRASE'),
    tokenSecret: get('BANK_TOKEN_SECRET'),
  };
  const missing = [
    ['R2_ACCOUNT_ID', cfg.accountId],
    ['R2_ACCESS_KEY_ID', cfg.accessKeyId],
    ['R2_SECRET_ACCESS_KEY', cfg.secretAccessKey],
    ['BANK_PASSPHRASE', cfg.passphrase],
    ['BANK_TOKEN_SECRET', cfg.tokenSecret],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  return { cfg, missing };
}

function sign(cfg, method, key, extra = {}) {
  return core.presignObject({
    method,
    accountId: cfg.accountId,
    bucket: cfg.bucket,
    key,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    ...extra,
  });
}

function emptyIndex() {
  return { version: 1, rev: 0, folders: [], items: [] };
}

async function readIndex(cfg) {
  const response = await fetch(sign(cfg, 'GET', core.INDEX_KEY, { expires: 60 }));
  if (response.status === 404) return { index: emptyIndex(), etag: null };
  if (!response.ok) throw new Error(`R2 čtení indexu selhalo (HTTP ${response.status}).`);
  return { index: await response.json(), etag: response.headers.get('etag') };
}

async function writeIndex(cfg, index, etag) {
  const headers = { 'Content-Type': 'application/json' };
  if (etag) headers['If-Match'] = etag;
  else headers['If-None-Match'] = '*';
  const response = await fetch(sign(cfg, 'PUT', core.INDEX_KEY, { expires: 60 }), {
    method: 'PUT',
    headers,
    body: JSON.stringify(index),
  });
  if (response.status === 412) return { conflict: true };
  if (!response.ok) throw new Error(`R2 zápis indexu selhal (HTTP ${response.status}).`);
  return { conflict: false, etag: response.headers.get('etag') };
}

function validKeys(keys) {
  return Array.isArray(keys) && keys.length > 0 && keys.length <= MAX_KEYS_PER_CALL && keys.every(core.isBankKey);
}

async function handleAuthed(op, body, cfg) {
  switch (op) {
    case 'index-get': {
      const { index, etag } = await readIndex(cfg);
      return json(200, { index, etag });
    }

    case 'index-put': {
      const next = body.index;
      const problem = core.validateIndex(next);
      if (problem) return json(400, { error: problem });
      const current = await readIndex(cfg);
      // Revize hlídá souběžné úpravy (dvě okna, dvě zařízení); klient při konfliktu načte znovu.
      if (current.index.rev !== next.rev - 1) return json(409, { error: 'Index mezitím změnil jiný klient.', index: current.index });
      const written = await writeIndex(cfg, next, current.etag);
      if (written.conflict) {
        const fresh = await readIndex(cfg);
        return json(409, { error: 'Index mezitím změnil jiný klient.', index: fresh.index });
      }
      return json(200, { rev: next.rev });
    }

    case 'upload-url': {
      const contentType = String(body.contentType || '');
      const size = Number(body.size || 0);
      if (!core.IMAGE_TYPES[contentType]) return json(400, { error: 'Nepodporovaný typ obrázku (JPEG, PNG, WebP, GIF).' });
      if (!Number.isFinite(size) || size <= 0 || size > MAX_UPLOAD_BYTES) return json(400, { error: 'Obrázek je prázdný nebo větší než 40 MB.' });
      const keys = core.newObjectKeys(contentType);
      return json(200, {
        id: keys.id,
        itemKey: keys.itemKey,
        thumbKey: keys.thumbKey,
        itemUrl: sign(cfg, 'PUT', keys.itemKey, { expires: UPLOAD_EXPIRES, contentType }),
        thumbUrl: sign(cfg, 'PUT', keys.thumbKey, { expires: UPLOAD_EXPIRES, contentType: 'image/jpeg' }),
        expires: UPLOAD_EXPIRES,
      });
    }

    case 'download-urls': {
      if (!validKeys(body.keys)) return json(400, { error: 'Neplatný seznam klíčů.' });
      const urls = {};
      for (const key of body.keys) urls[key] = sign(cfg, 'GET', key, { expires: DOWNLOAD_EXPIRES });
      return json(200, { urls, expires: DOWNLOAD_EXPIRES });
    }

    case 'delete-objects': {
      if (!validKeys(body.keys)) return json(400, { error: 'Neplatný seznam klíčů.' });
      const results = await Promise.all(
        body.keys.map(async (key) => {
          const response = await fetch(sign(cfg, 'DELETE', key, { expires: 60 }), { method: 'DELETE' });
          return response.ok || response.status === 404;
        }),
      );
      return json(200, { deleted: results.filter(Boolean).length, failed: results.filter((ok) => !ok).length });
    }

    default:
      return json(400, { error: 'Neznámá operace.' });
  }
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    let body = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return json(400, { error: 'Invalid JSON body' });
    }

    const op = String(body.op || '');
    const { cfg, missing } = config();

    if (op === 'status') return json(200, { configured: missing.length === 0, missing });
    if (missing.length > 0) return json(503, { error: 'Databanka není nakonfigurovaná.', missing });

    if (op === 'login') {
      if (!core.checkPassphrase(body.passphrase, cfg.passphrase)) {
        // Zpomalení brání rychlému hádání (na Vercelu nejede rate limit z dev serveru).
        await new Promise((resolve) => setTimeout(resolve, FAILED_LOGIN_DELAY_MS));
        return json(401, { error: 'Nesprávné heslo.' });
      }
      return json(200, core.signToken(cfg.tokenSecret));
    }

    if (!core.verifyToken(cfg.tokenSecret, core.bearerToken(event.headers))) {
      return json(401, { error: 'Přihlášení vypršelo nebo chybí.' });
    }
    return await handleAuthed(op, body, cfg);
  } catch (err) {
    return json(500, { error: 'Databanka selhala.', detail: String(err?.message || err) });
  }
};
