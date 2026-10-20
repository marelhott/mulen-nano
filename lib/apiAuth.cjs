// Sdílené ověření přístupu k serverovým endpointům.
// Jediné tajemství aplikace je PIN k Databance: přihlášením vznikne podepsaný token,
// který server ověří přes BANK_TOKEN_SECRET. Platí pro banku, R2 presign i placené
// volání poskytovatelů (OpenRouter, Venice), aby je nemohl zneužít kdokoli z internetu.

const bankCore = require('../utils/bankServerCore.cjs');

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(statusCode, payload) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(payload) };
}

/** Vrací null, když je požadavek autorizovaný; jinak hotovou chybovou odpověď. */
function denyUnauthorized(event, successKey = 'success') {
  const secret = String(process.env.BANK_TOKEN_SECRET || '').trim();
  if (!secret) {
    return json(503, {
      [successKey]: false,
      error: 'Serverové generování není nakonfigurované (chybí BANK_TOKEN_SECRET).',
    });
  }
  if (!bankCore.verifyToken(secret, bankCore.bearerToken(event.headers))) {
    return json(401, {
      [successKey]: false,
      error: 'Pro generování se nejdřív přihlas PINem ke knihovně.',
    });
  }
  return null;
}

module.exports = { json, denyUnauthorized, JSON_HEADERS };
