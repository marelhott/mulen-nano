import type {
  GenerateImageResult,
  ImageInput,
  ProviderSettings,
} from './aiProvider';
import { OpenRouterProvider } from './openRouterService';
import { serverProviderProxy } from './serverProviderProxy';
import type { ExternalImageModel } from '../constants/externalImageModels';

export class ExternalImageProvider extends OpenRouterProvider {
  constructor(
    private readonly model: ExternalImageModel,
    private readonly settings: ProviderSettings
  ) {
    super(settings.openrouter?.apiKey);
  }
  getName() {
    return this.model.startsWith('runware/') ? 'Runware' : 'Venice';
  }
  async generateImage(
    images: ImageInput[],
    prompt: string,
    resolution?: string,
    aspectRatio?: string
  ): Promise<GenerateImageResult> {
    let dimensions: { width?: number; height?: number } = {};
    if (
      this.model === 'runware/sdxl' &&
      images[0] &&
      (!aspectRatio || aspectRatio === 'Original')
    ) {
      const image = new Image();
      image.src = images[0].data;
      await image.decode();
      dimensions = { width: image.naturalWidth, height: image.naturalHeight };
    }
    return serverProviderProxy.generateImage({
      images,
      prompt,
      resolution,
      aspectRatio,
      preferredModel: this.model,
      externalApiKey: this.model.startsWith('runware/')
        ? this.settings.runware?.apiKey
        : this.settings.venice?.apiKey,
      runwareModel: this.settings.runware?.model,
      strength: this.settings.runware?.strength ?? 0.35,
      ...dimensions,
    });
  }
}
