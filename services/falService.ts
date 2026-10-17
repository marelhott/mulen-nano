import { imageExecutionProvider, readImageExecution, type ImageExecution } from './imageExecution';
import { runConcurrentTasks } from '../utils/concurrencyRunner';

type QueuedParams = { imageUrlOrDataUrl: string; prompt?: string; numImages?: number; onPhase?: (phase: 'queue' | 'running' | 'finalizing') => void; loras?: unknown[]; execution?: ImageExecution; [key: string]: unknown };

async function runImageTool(params: QueuedParams) {
  if (Array.isArray(params.loras) && params.loras.length > 0) {
    throw new Error('Vlastní LoRA adaptéry nejsou u připojených obrazových API podporované. Úloha není nahrazena generickým obrázkem.');
  }
  if (params.modelName) {
    throw new Error('Vlastní SDXL checkpoint nelze načíst připojenými obrazovými API. Pro checkpoint použij lokální A1111; běžný obrazový model není jeho náhrada.');
  }
  const execution = params.execution ?? readImageExecution();
  const provider = imageExecutionProvider(execution);
  params.onPhase?.('queue');
  const count = Math.max(1, Math.min(10, Math.round(params.numImages || 1)));
  const results = await runConcurrentTasks({
    items: Array.from({ length: count }), concurrency: 2,
    worker: async () => {
      params.onPhase?.('running');
      return provider.generateImage([{ data: params.imageUrlOrDataUrl, mimeType: 'image/png' }],
        String(params.prompt || 'Zachovej obsah obrázku a zlepši jeho technickou kvalitu.'));
    },
  });
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.error;
  const images = results.flatMap((result) => result.status === 'fulfilled' ? [result.value.imageBase64] : []);
  params.onPhase?.('finalizing');
  return { images, image: images[0], usedSeed: undefined };
}

export const runFalLoraImg2Img = runImageTool;
export const runFalLoraImg2ImgQueued = runImageTool;
export const runFalFluxLoraImg2ImgQueued = runImageTool;
export const runFalModelQueued = runImageTool;
export async function runFalUpscaleQueued(params: QueuedParams & { upscaleFactor?: number }) {
  return runImageTool({ ...params, prompt: `Upscale ${params.upscaleFactor || 2}x. Preserve geometry, identity and composition; improve only authentic detail, texture and sharpness. Do not add creative content.` });
}
export const runFalFaithfulUpscaleQueued = runFalUpscaleQueued;
