import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { generateImage } = require('../lib/openrouter.cjs');
const bankCore = require('../utils/bankServerCore.cjs');

const TOKEN_SECRET = 'test-token-secret';
const AUTH_HEADERS = { authorization: `Bearer ${bankCore.signToken(TOKEN_SECRET).token}` };

const DATA_URL = 'data:image/png;base64,AAAA';

function mockFetch(responseBody: unknown) {
  const calls: Array<{ url: string; body: any }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => responseBody };
  }));
  return calls;
}

describe('openrouter generateImage', () => {
  beforeEach(() => vi.stubEnv('BANK_TOKEN_SECRET', TOKEN_SECRET));
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('posílá vstupní obrázky jako objekty image_url (ne holé řetězce)', async () => {
    const calls = mockFetch({ data: [{ b64_json: 'QUJD' }] });
    await generateImage({ model: 'openai/test', prompt: 'p', images: [DATA_URL], apiKey: 'k'.repeat(30) });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/images');
    expect(calls[0].body.input_references).toEqual([{ type: 'image_url', image_url: { url: DATA_URL } }]);
  });

  it('už hotové objekty nechá beze změny', async () => {
    const reference = { type: 'image_url', image_url: { url: 'https://x/y.png' } };
    const calls = mockFetch({ data: [{ b64_json: 'QUJD' }] });
    await generateImage({ model: 'openai/test', prompt: 'p', images: [reference], apiKey: 'k'.repeat(30) });
    expect(calls[0].body.input_references).toEqual([reference]);
  });

  it('bez obrázků neposílá input_references a Original poměr stran vynechá', async () => {
    const calls = mockFetch({ data: [{ b64_json: 'QUJD' }] });
    await generateImage({ model: 'openai/test', prompt: 'p', images: [], aspectRatio: 'Original', apiKey: 'k'.repeat(30) });
    expect(calls[0].body.input_references).toBeUndefined();
    expect(calls[0].body.aspect_ratio).toBeUndefined();
  });
  it('zachová stav a detail kvóty Google z metadat chyby', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => ({ error: {
      message: 'You exceeded your current quota…', metadata: { provider_name: 'Google AI Studio', raw: JSON.stringify({ error: { message: 'Quota exceeded for model gemini-nano-banana-2.1, limit: 0.' } }) },
    } }) })));
    await expect(generateImage({ apiKey: 'test', prompt: 'p' })).rejects.toMatchObject({ upstreamStatus: 429, provider: 'Google AI Studio', message: expect.stringContaining('limit: 0') });
  });

  it('server předá stav 429 a podrobnost limitu bez identifikátoru Google projektu', async () => {
    const { handler } = require('../api/_core/provider-generate.cjs');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => ({ error: {
      message: 'Quota exceeded', metadata: { provider_name: 'Google AI Studio', is_byok: false, raw: JSON.stringify({ error: { message: 'Google model quota exhausted', details: [{ violations: [{ quotaMetric: 'requests_per_model', quotaValue: '0', quotaDimensions: { model: 'gemini-nano-banana-2.1', project: 'private-project' } }] }, { retryDelay: '60s' }] } }) },
    } }) })));
    const result = await handler({ httpMethod: 'POST', headers: AUTH_HEADERS, body: JSON.stringify({ action: 'generateImage', apiKey: 'test', preferredModel: 'google/gemini-nano-banana-2.1', prompt: 'test' }) });
    expect(result.statusCode).toBe(429);
    expect(JSON.parse(result.body)).toMatchObject({ success: false, provider: 'Google AI Studio', isByok: false, quota: [{ metric: 'requests_per_model', limit: '0', model: 'gemini-nano-banana-2.1' }, { retryDelay: '60s' }] });
    expect(result.body).not.toContain('private-project');
  });

  it('odmítne generování serverovým klíčem bez přihlášení', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { handler } = require('../api/_core/provider-generate.cjs');
    const result = await handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'generateImage', prompt: 'test' }) });
    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body).success).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('vlastní klíč projde i bez přihlášení', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: [{ b64_json: 'QUJD' }] }) })));
    const { handler } = require('../api/_core/provider-generate.cjs');
    const result = await handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'generateImage', prompt: 'test', apiKey: 'k'.repeat(30) }) });
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).success).toBe(true);
  });

});
