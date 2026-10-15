import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { handler } = require('../api/_core/bank.cjs');
const core = require('./bankServerCore.cjs');
let token = '';
const request = async (body: unknown, authenticated = true) => {
  const response = await handler({ httpMethod: 'POST', headers: authenticated ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) });
  return { status: response.statusCode, ...JSON.parse(response.body) };
};
beforeEach(() => {
  for (const key of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'BANK_PASSPHRASE', 'BANK_TOKEN_SECRET']) vi.stubEnv(key, `test-${key}`);
  token = core.signToken(process.env.BANK_TOKEN_SECRET).token;
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('R2 knihovna a feed API', () => {
  it('platný starý token převede na trvalé přihlášení, bez ověření ho nevydá', async () => {
    token = core.signToken(process.env.BANK_TOKEN_SECRET, Date.now(), 60000).token;
    const result = await request({ op: 'session' });
    expect(result.status).toBe(200);
    expect(result.expiresAt).toBeNull();
    expect(core.verifyToken(process.env.BANK_TOKEN_SECRET, result.token)).toBe(true);
    expect((await request({ op: 'session' }, false)).status).toBe(401);
  });
  it('přihlášení vrátí zapamatovaný token bez časového vypršení', async () => {
    const result = await request({ op: 'login', passphrase: process.env.BANK_PASSPHRASE }, false);
    expect(result.status).toBe(200);
    expect(result.expiresAt).toBeNull();
  });
  it('nepovolí čtení bez přihlášení ani libovolný název indexu', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect((await request({ op: 'index-get' }, false)).status).toBe(401);
    expect((await request({ op: 'index-get', space: '../other' })).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('čte feed odděleně od knihovny a požaduje silný ETag bez komprese', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: 1, rev: 0, folders: [], items: [] }), { headers: { ETag: '"strong-etag"' } }));
    vi.stubGlobal('fetch', fetch);
    expect((await request({ op: 'index-get', space: 'feed' })).status).toBe(200);
    expect(new URL(fetch.mock.calls[0][0]).pathname).toBe('/mulen-nano/feed.json');
    expect(fetch.mock.calls[0][1].headers['Accept-Encoding']).toBe('identity');
    await request({ op: 'index-get' });
    expect(new URL(fetch.mock.calls[1][0]).pathname).toBe('/mulen-nano/index.json');
  });
  it('předá původní ETag do If-Match při dalším zápisu', async () => {
    const index = { version: 1, rev: 4, folders: [], items: [] };
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(index), { headers: { ETag: '"etag-4"' } })).mockResolvedValueOnce(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    expect((await request({ op: 'index-put', index: { ...index, rev: 5 } })).status).toBe(200);
    expect(fetch.mock.calls[1][1].headers['If-Match']).toBe('"etag-4"');
  });
  it('konflikt neřeší přepsáním novějšího indexu', async () => {
    const index = { version: 1, rev: 7, folders: [], items: [] };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(index), { headers: { ETag: '"7"' } })); vi.stubGlobal('fetch', fetch);
    const result = await request({ op: 'index-put', index: { ...index, rev: 6 } });
    expect(result.status).toBe(409); expect(result.index.rev).toBe(7); expect(fetch).toHaveBeenCalledTimes(1);
  });
});
