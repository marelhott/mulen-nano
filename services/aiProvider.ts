/** Jediná AI brána aplikace. Model může patřit libovolnému katalogu OpenRouteru. */
export enum AIProviderType {
  OPENROUTER = 'openrouter',
}

export interface ImageInput { data: string; mimeType: string; }
export interface GenerateImageResult { imageBase64: string; groundingMetadata?: Array<{ url: string; title: string }>; modelId?: string; }
export interface ProviderConfig { apiKey: string; enabled: boolean; }
export type HeadSwapPrimaryProvider = 'openrouter';
export type HeadSwapFallbackProvider = 'facefusion' | 'reface';
export type HeadSwapHairSource = 'user' | 'target';
export type HeadSwapGender = 'default' | 'a man' | 'a woman' | 'nonbinary person';

export interface HeadSwapSettings {
  preferredPrimary: HeadSwapPrimaryProvider;
  hairSource: HeadSwapHairSource;
  sourceGender: HeadSwapGender;
  secondarySourceGender: HeadSwapGender;
  useUpscale: boolean;
  useDetailer: boolean;
  facefusionEndpoint?: string;
  refaceEndpoint?: string;
}

export interface ProviderSettings {
  [AIProviderType.OPENROUTER]?: ProviderConfig;
  a1111?: { baseUrl: string; sdxlVae?: string; enabled: boolean };
  headSwap?: HeadSwapSettings;
}

export interface AIProvider {
  generateImage(images: ImageInput[], prompt: string, resolution?: string, aspectRatio?: string, useGrounding?: boolean): Promise<GenerateImageResult>;
  enhancePrompt(shortPrompt: string): Promise<string>;
  getName(): string;
  getType(): AIProviderType;
}

export interface ProviderMetadata { type: AIProviderType; name: string; icon: string; requiresApiKey: boolean; supportsGrounding: boolean; maxImages: number; }
export const PROVIDER_METADATA: Record<AIProviderType, ProviderMetadata> = {
  [AIProviderType.OPENROUTER]: { type: AIProviderType.OPENROUTER, name: 'OpenRouter', icon: 'openrouter', requiresApiKey: false, supportsGrounding: false, maxImages: 10 },
};
