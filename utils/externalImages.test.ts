import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { ProviderFactory } from '../services/providerFactory';
import { AIProviderType } from '../services/aiProvider';
const require = createRequire(import.meta.url);
const bankCore = require('../utils/bankServerCore.cjs');

const TOKEN_SECRET = 'test-token-secret';
const AUTH_HEADERS = { authorization: `Bearer ${bankCore.signToken(TOKEN_SECRET).token}` };
const {
  generateExternalImage,
  dimensions,
} = require('../lib/external-images.cjs');
const { handler } = require('../api/_core/provider-generate.cjs');
const image = 'data:image/png;base64,aGVsbG8=';
const base = {
  preferredModel: 'venice/qwen-edit-uncensored',
  images: [{ data: image }],
  prompt: 'Zachovej koláž.',
  externalApiKey: 'venice-test',
};

beforeEach(() => vi.stubEnv('BANK_TOKEN_SECRET', TOKEN_SECRET));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('Explicitní externí obrazové služby', () => {
  it.each([
    'venice/qwen-edit-uncensored',
    'venice/qwen-image-2-1-turbo-edit',
    'venice/qwen-image-2-1-pro-edit',
  ])('posílá jediný obrázek na Venice edit: %s', async (model) => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('image-bytes', {
          headers: { 'content-type': 'image/png' },
        })
      );
    vi.stubGlobal('fetch', fetch);
    const result = await generateExternalImage({
      ...base,
      preferredModel: model,
    });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://api.venice.ai/api/v1/image/edit');
    expect(options.headers.Authorization).toBe('Bearer venice-test');
    expect(JSON.parse(options.body)).toMatchObject({
      model: model.replace('venice/', ''),
      image,
      prompt: base.prompt,
    });
    expect(result.imageBase64).toBe(
      `data:image/png;base64,${Buffer.from('image-bytes').toString('base64')}`
    );
  });
  it('více referencí ponechá ve správném pořadí', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('png', { headers: { 'content-type': 'image/png' } })
      );
    vi.stubGlobal('fetch', fetch);
    await generateExternalImage({
      ...base,
      images: [{ data: image }, { data: image }],
    });
    expect(fetch.mock.calls[0][0]).toContain('/image/multi-edit');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      modelId: 'qwen-edit-uncensored',
      images: [image, image],
    });
  });
  it.each([
    [{ ...base, images: [] }, 'alespoň jeden'],
    [{ ...base, images: Array(4).fill({ data: image }) }, 'nejvýše 3'],
    [
      { ...base, images: [{ data: 'https://internal.example/image' }] },
      'Vstup musí',
    ],
    [
      { ...base, preferredModel: 'venice/lustify-v8' },
      'pouze generování z textu',
    ],
    [{ ...base, prompt: 'x'.repeat(1501) }, '1500'],
    [{ ...base, preferredModel: 'runware/sdxl' }, 'Nepodporovaný externí model'],
  ])('neignoruje nekompatibilní vstup', async (body, error) => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(generateExternalImage(body)).rejects.toThrow(error);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('Lustify bez vstupu používá pouze textovou cestu', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ images: ['aGVsbG8='] }));
    vi.stubGlobal('fetch', fetch);
    const result = await generateExternalImage({
      ...base,
      preferredModel: 'venice/lustify-v8',
      images: [],
    });
    expect(fetch.mock.calls[0][0]).toContain('/image/generate');
    expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe('lustify-v8');
    expect(result.imageBase64).toBe(image);
  });
  it('chybějící Venice klíč nenahradí OpenRouter klíčem', async () => {
    vi.stubEnv('VENICE_API_KEY', '');
    vi.stubEnv('OPENROUTER_API_KEY', 'or-secret');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      generateExternalImage({ ...base, externalApiKey: undefined })
    ).rejects.toThrow('VENICE_API_KEY');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('nepřepošle citlivý chybový obsah upstreamu', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: 'sensitive request' }, { status: 401 })
        )
    );
    await expect(generateExternalImage(base)).rejects.toThrow(
      'Neplatný API klíč'
    );
    await expect(generateExternalImage(base)).rejects.not.toThrow('sensitive');
  });
  it('API zachová původní success/result kontrakt a oddělí klíče', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('png', { headers: { 'content-type': 'image/png' } })
      );
    vi.stubGlobal('fetch', fetch);
    const response = await handler({
      httpMethod: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        action: 'generateImage',
        ...base,
        apiKey: 'or-secret',
      }),
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      success: true,
      result: { modelId: base.preferredModel },
    });
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe(
      'Bearer venice-test'
    );
    expect(fetch.mock.calls[0][1].body).not.toContain('or-secret');
  });
  it('factory směruje pouze explicitně vybrané modely', () => {
    expect(
      ProviderFactory.getProvider(
        AIProviderType.OPENROUTER,
        {},
        'venice/qwen-edit-uncensored'
      ).getName()
    ).toBe('Venice');
    expect(
      ProviderFactory.getProvider(
        AIProviderType.OPENROUTER,
        {},
        'google/gemini-3-pro-image'
      ).getName()
    ).toBe('OpenRouter');
  });
  it('klient neposílá OpenRouter klíč v externím generačním požadavku', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ success: true, result: { imageBase64: image } })
      );
    vi.stubGlobal('fetch', fetch);
    const provider = ProviderFactory.getProvider(
      AIProviderType.OPENROUTER,
      {
        openrouter: { apiKey: 'or-private', enabled: true },
        venice: { apiKey: 'venice-private', enabled: true },
      },
      'venice/qwen-edit-uncensored'
    );
    await provider.generateImage(
      [{ data: image, mimeType: 'image/png' }],
      'Koláž'
    );
    const request = JSON.parse(fetch.mock.calls[0][1].body);
    expect(request.externalApiKey).toBe('venice-private');
    expect(request.preferredModel).toBe('venice/qwen-edit-uncensored');
    expect(request.apiKey).toBeUndefined();
    expect(fetch.mock.calls[0][1].body).not.toContain('or-private');
  });
  it('rozměry zachovají poměr originálu v násobcích osmi', () => {
    expect(dimensions({ width: 600, height: 1200 })).toEqual({
      width: 512,
      height: 1024,
    });
  });
});

describe('cleanKey', () => {
  it('odstraní uvozovky, mezery a literální \\n z klíčů vložených do Vercelu', async () => {
    const { cleanKey } = await import('../lib/external-images.cjs');
    expect(cleanKey('  abc123  ')).toBe('abc123');
    expect(cleanKey('"abc123"')).toBe('abc123');
    expect(cleanKey("'abc123'")).toBe('abc123');
    expect(cleanKey('abc123\\n')).toBe('abc123');
    expect(cleanKey('"abc123\\n"')).toBe('abc123');
    expect(cleanKey(undefined)).toBe('');
  });
});
