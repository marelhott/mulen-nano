import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_MODELS, imageModelInputError } from '../constants/imageModels';
import { ProviderFactory } from './providerFactory';
import { AIProviderType } from './aiProvider';
import { serverProviderProxy } from './serverProviderProxy';
import { runFofrStyleTransfer } from './replicateService';
import { runFalModelQueued, runFalUpscaleQueued } from './falService';
import { runHeadSwap } from './headSwapService';

vi.mock('../utils/imagePanelComposite', () => ({ createReferenceStyleComposite: vi.fn(async () => ({ data: 'data:image/png;base64,YQ==', mimeType: 'image/png' })) }));
const source = { data: 'data:image/png;base64,YQ==', mimeType: 'image/png' };
const settings = { openrouter: { apiKey: 'test-router', enabled: true }, venice: { apiKey: 'test-venice', enabled: true }, runware: { apiKey: 'test-runware', enabled: true, model: 'test:1@1', strength: 0.35 } };

beforeEach(() => {
  vi.stubGlobal('Image', class { src = ''; naturalWidth = 1024; naturalHeight = 768; async decode() {} });
  vi.spyOn(serverProviderProxy, 'generateImage').mockImplementation(async (params) => ({ imageBase64: `image-${params.preferredModel}`, modelId: params.preferredModel }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('jednotné skutečné směrování obrazových modelů', () => {
  it.each(IMAGE_MODELS)('$title pošle přesný model a správný klíč, ne náhradní Nano', async (entry) => {
    const images = entry.maxInputs === 0 ? [] : [source];
    const provider = ProviderFactory.getProvider(AIProviderType.OPENROUTER, settings, entry.model);
    await provider.generateImage(images, 'Test', '1K', 'Original');
    expect(serverProviderProxy.generateImage).toHaveBeenCalledWith(expect.objectContaining({ preferredModel: entry.model }));
    const request = vi.mocked(serverProviderProxy.generateImage).mock.calls[0][0];
    expect(request.externalApiKey ?? request.apiKey).toBe(entry.model.startsWith('venice/') ? 'test-venice' : entry.model.startsWith('runware/') ? 'test-runware' : 'test-router');
    expect(request.resolution).toBe(entry.resolution);
  });

  it.each(IMAGE_MODELS.filter((entry) => entry.maxInputs !== 0))('Face/head swap použije i $title', async (entry) => {
    const result = await runHeadSwap({ request: { sourceImage: source.data, targetImage: source.data, outputCount: 1, imageModel: entry.model }, settings });
    expect(result.outputs[0].modelId).toBe(entry.model);
    expect(serverProviderProxy.generateImage).toHaveBeenCalledWith(expect.objectContaining({ preferredModel: entry.model }));
  });

  it('Lustify odmítne úpravu před requestem a bez fallbacku', async () => {
    const provider = ProviderFactory.getProvider(AIProviderType.OPENROUTER, settings, 'venice/lustify-v8');
    await expect(provider.generateImage([source], 'Edit')).rejects.toThrow('pouze generování z textu');
    expect(serverProviderProxy.generateImage).not.toHaveBeenCalled();
  });

  it('stylový přenos vytváří skutečně samostatné výstupy vybraným modelem', async () => {
    vi.mocked(serverProviderProxy.generateImage).mockImplementation(async () => ({ imageBase64: `result-${vi.mocked(serverProviderProxy.generateImage).mock.calls.length}` }));
    const images = await runFofrStyleTransfer({ styleImage: source.data, structureImage: source.data, numberOfImages: 3, execution: { model: 'venice/qwen-image-2-1-pro-edit', settings } });
    expect(new Set(images).size).toBe(3);
    expect(serverProviderProxy.generateImage).toHaveBeenCalledTimes(3);
    expect(serverProviderProxy.generateImage).toHaveBeenLastCalledWith(expect.objectContaining({ preferredModel: 'venice/qwen-image-2-1-pro-edit', images: [source, source] }));
  });

  it('starší cloudový nástroj i upscale respektují explicitní model', async () => {
    const execution = { model: 'venice/qwen-image-2-1-pro-edit' as const, settings };
    const output = await runFalModelQueued({ imageUrlOrDataUrl: source.data, prompt: 'Edit', numImages: 3, execution });
    expect(output.images).toHaveLength(3);
    await runFalUpscaleQueued({ imageUrlOrDataUrl: source.data, execution });
    expect(serverProviderProxy.generateImage).toHaveBeenCalledTimes(4);
    expect(vi.mocked(serverProviderProxy.generateImage).mock.calls.every(([params]) => params.preferredModel === execution.model)).toBe(true);
  });

  it('vlastní LoRA ani checkpoint se nikdy nenahradí generickým modelem', async () => {
    await expect(runFalModelQueued({ imageUrlOrDataUrl: source.data, loras: [{}] })).rejects.toThrow('LoRA');
    await expect(runFalModelQueued({ imageUrlOrDataUrl: source.data, modelName: 'custom.safetensors' })).rejects.toThrow('checkpoint');
    expect(serverProviderProxy.generateImage).not.toHaveBeenCalled();
  });

  it('limity vstupů chrání všechny sekce', () => {
    expect(imageModelInputError('venice/qwen-edit-uncensored', 0)).toContain('vyžaduje');
    expect(imageModelInputError('recraft/recraft-v4.1-pro', 2)).toContain('nejvýše 1');
    expect(imageModelInputError('venice/qwen-image-2-1-pro-edit', 10)).toBeUndefined();
  });
});
