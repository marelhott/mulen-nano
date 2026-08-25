import { AIProvider, AIProviderType, ProviderSettings } from './aiProvider';
import { OpenRouterProvider } from './openRouterService';

export class ProviderFactory {
  static createProvider(_type: AIProviderType, preferredImageModel?: string, apiKey?: string): AIProvider {
    return new OpenRouterProvider(apiKey, preferredImageModel);
  }
  static getProvider(selectedType: AIProviderType, settings: ProviderSettings): AIProvider {
    return this.createProvider(selectedType, undefined, settings[AIProviderType.OPENROUTER]?.apiKey);
  }
  static validateApiKey(_type: AIProviderType, apiKey: string): boolean {
    return apiKey.trim().length > 20;
  }
}
