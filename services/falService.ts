import { serverProviderProxy } from './serverProviderProxy';

type QueuedParams = { imageUrlOrDataUrl: string; prompt?: string; numImages?: number; onPhase?: (phase: 'queue' | 'running' | 'finalizing') => void; loras?: unknown[]; [key: string]: unknown };

async function runImageTool(params: QueuedParams, model = 'black-forest-labs/flux.2-pro') {
  if (Array.isArray(params.loras) && params.loras.length > 0) {
    throw new Error('Tato LoRA úloha je blokovaná: OpenRouter pro zvolený model nepřijímá vlastní LoRA adaptéry. Není použit žádný přímý fallback.');
  }
  params.onPhase?.('queue');
  params.onPhase?.('running');
  const result = await serverProviderProxy.generateImage({
    images: [{ data: params.imageUrlOrDataUrl, mimeType: 'image/png' }],
    prompt: String(params.prompt || 'Zachovej obsah obrázku a zlepši jeho technickou kvalitu.'),
    preferredModel: model,
  });
  params.onPhase?.('finalizing');
  return { images: [result.imageBase64], image: result.imageBase64, usedSeed: undefined };
}

export const runFalLoraImg2Img = runImageTool;
export const runFalLoraImg2ImgQueued = runImageTool;
export const runFalFluxLoraImg2ImgQueued = runImageTool;
export const runFalModelQueued = runImageTool;
export async function runFalUpscaleQueued(params: QueuedParams & { upscaleFactor?: number }) {
  return runImageTool({ ...params, prompt: `Upscale ${params.upscaleFactor || 2}x. Preserve geometry, identity and composition; improve only authentic detail, texture, sharpness and lighting. Do not add creative content.` }, 'google/gemini-3-pro-image-preview');
}
export const runFalFaithfulUpscaleQueued = runFalUpscaleQueued;
