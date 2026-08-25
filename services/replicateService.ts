import { AIProvider, AIProviderType, GenerateImageResult, ImageInput } from './aiProvider';
import { OpenRouterProvider } from './openRouterService';

export async function runReplicatePrediction(params: { token?: string; timeoutMs?: number; input?: Record<string, unknown>; prompt?: string; model?: string }) {
  const input = params.input || {};
  const image = String(input.image || input.input_image || '');
  const result = await new OpenRouterProvider('google/gemini-3-pro-image-preview').generateImage(
    image ? [{ data: image, mimeType: 'image/png' }] : [],
    String(params.prompt || 'Upscale faithfully. Preserve content; improve only real detail and sharpness.'),
  );
  return { status: 'succeeded', output: result.imageBase64, error: undefined as string | undefined };
}

export async function runFofrStyleTransfer(params: { token?: string; styleImage: string; structureImage?: string; prompt?: string; negativePrompt?: string; numberOfImages?: number; [key: string]: unknown }) {
  const provider = new OpenRouterProvider('google/gemini-3-pro-image-preview');
  const result = await provider.generateImage(
    [params.structureImage || params.styleImage, params.styleImage].filter(Boolean).map((data) => ({ data, mimeType: 'image/png' })),
    params.prompt || 'Transfer the visual style naturally while preserving the content and composition.',
  );
  return Array.from({ length: Math.max(1, params.numberOfImages || 1) }, () => result.imageBase64);
}

export class ReplicateProvider implements AIProvider {
  private readonly provider = new OpenRouterProvider('black-forest-labs/flux.2-pro');
  getName() { return this.provider.getName(); }
  getType() { return AIProviderType.OPENROUTER; }
  enhancePrompt(prompt: string) { return this.provider.enhancePrompt(prompt); }
  generateImage(images: ImageInput[], prompt: string, resolution?: string, aspectRatio?: string): Promise<GenerateImageResult> {
    return this.provider.generateImage(images, prompt, resolution, aspectRatio);
  }
}
