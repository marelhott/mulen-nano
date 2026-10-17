import { AIProvider, AIProviderType, ProviderSettings } from './aiProvider';
import { OpenRouterProvider } from './openRouterService';
import { ExternalImageProvider } from './externalImageProvider';
import { isExternalImageModel } from '../constants/externalImageModels';
import { imageModelById, imageModelInputError } from '../constants/imageModels';

export class ProviderFactory {
  static createProvider(_type: AIProviderType, preferredImageModel?: string, apiKey?: string): AIProvider {
    return new OpenRouterProvider(apiKey, preferredImageModel);
  }
  static getProvider(selectedType: AIProviderType, settings: ProviderSettings, preferredImageModel?: string): AIProvider {
    const provider = isExternalImageModel(preferredImageModel)
      ? new ExternalImageProvider(preferredImageModel, settings)
      : this.createProvider(selectedType, preferredImageModel, settings[AIProviderType.OPENROUTER]?.apiKey);
    const generate = provider.generateImage.bind(provider);
    provider.generateImage = async (images, prompt, resolution, aspectRatio, grounding) => {
      const model = preferredImageModel || 'google/gemini-3-pro-image';
      const error = imageModelInputError(model, images.length);
      if (error) throw new Error(error);
      // Modely bez parametru resolution nesmí dostat nepodporovaný parametr.
      const supportsResolution = imageModelById(model)?.resolution !== undefined;
      return generate(images, prompt, supportsResolution && resolution !== 'match' ? resolution : undefined, aspectRatio, grounding);
    };
    return provider;
  }
  static validateApiKey(_type: AIProviderType, apiKey: string): boolean {
    return apiKey.trim().length > 20;
  }
}
