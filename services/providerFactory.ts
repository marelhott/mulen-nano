import { AIProvider, AIProviderType, ProviderSettings } from './aiProvider';
import { OpenRouterProvider } from './openRouterService';

export class ProviderFactory {
  static createProvider(_type: AIProviderType, preferredImageModel?: string): AIProvider {
    return new OpenRouterProvider(preferredImageModel);
  }
  static getProvider(selectedType: AIProviderType, _settings: ProviderSettings): AIProvider {
    return this.createProvider(selectedType);
  }
  static validateApiKey(_type: AIProviderType, apiKey: string): boolean {
    return apiKey.trim().length > 20;
  }
}
