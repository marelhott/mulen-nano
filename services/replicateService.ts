import { AIProvider, AIProviderType, GenerateImageResult, ImageInput } from './aiProvider';
import { imageExecutionProvider, readImageExecution, type ImageExecution } from './imageExecution';

export async function runReplicatePrediction(params: { token?: string; timeoutMs?: number; input?: Record<string, unknown>; prompt?: string; model?: string }) {
  const input = params.input || {};
  const image = String(input.image || input.input_image || '');
  const result = await imageExecutionProvider().generateImage(
    image ? [{ data: image, mimeType: 'image/png' }] : [],
    String(params.prompt || 'Upscale faithfully. Preserve content; improve only real detail and sharpness.'),
  );
  return { status: 'succeeded', output: result.imageBase64, error: undefined as string | undefined };
}

export async function runFofrStyleTransfer(params: { token?: string; styleImage: string; structureImage?: string; prompt?: string; negativePrompt?: string; numberOfImages?: number; execution?: ImageExecution; [key: string]: unknown }) {
  const provider = imageExecutionProvider(params.execution ?? readImageExecution());
  const images = [params.structureImage, params.styleImage].filter((data): data is string => !!data).map((data) => ({ data, mimeType: 'image/png' }));
  const outputs: string[] = [];
  for (let index = 0; index < Math.max(1, Math.min(10, params.numberOfImages || 1)); index += 1) {
    const result = await provider.generateImage(images, params.prompt || 'Transfer the visual style from the last reference to the first image. Preserve the content and composition of the first image.');
    outputs.push(result.imageBase64);
  }
  return outputs;
}

export class ReplicateProvider implements AIProvider {
  private readonly provider = imageExecutionProvider();
  getName() { return this.provider.getName(); }
  getType() { return AIProviderType.OPENROUTER; }
  enhancePrompt(prompt: string) { return this.provider.enhancePrompt(prompt); }
  generateImage(images: ImageInput[], prompt: string, resolution?: string, aspectRatio?: string): Promise<GenerateImageResult> {
    return this.provider.generateImage(images, prompt, resolution, aspectRatio);
  }
}
