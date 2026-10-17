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
    return 'Venice';
  }
  async generateImage(
    images: ImageInput[],
    prompt: string,
    resolution?: string,
    aspectRatio?: string
  ): Promise<GenerateImageResult> {
    return serverProviderProxy.generateImage({
      images,
      prompt,
      resolution,
      aspectRatio,
      preferredModel: this.model,
      externalApiKey: this.settings.venice?.apiKey,
    });
  }
}
