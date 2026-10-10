import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { generateImage } = require('../lib/openrouter.cjs');

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
  afterEach(() => vi.unstubAllGlobals());

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
});
