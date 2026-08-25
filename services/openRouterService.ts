import { AIProvider, AIProviderType, GenerateImageResult, ImageInput } from './aiProvider';
import { serverProviderProxy } from './serverProviderProxy';

export class OpenRouterProvider implements AIProvider {
  private readonly preferredImageModel: string;
  private readonly apiKey?: string;
  constructor(apiKey?: string, preferredImageModel?: string) {
    this.apiKey = apiKey || undefined;
    this.preferredImageModel = preferredImageModel || 'google/gemini-3-pro-image';
  }
  getName(): string { return 'OpenRouter'; }
  getType(): AIProviderType { return AIProviderType.OPENROUTER; }
  enhancePrompt(shortPrompt: string): Promise<string> { return serverProviderProxy.enhancePrompt(shortPrompt, this.apiKey); }
  generateImage(images: ImageInput[], prompt: string, resolution?: string, aspectRatio?: string, useGrounding = false): Promise<GenerateImageResult> {
    return serverProviderProxy.generateImage({ images, prompt, resolution, aspectRatio, useGrounding, preferredModel: this.preferredImageModel, apiKey: this.apiKey });
  }
  generate3PromptVariants(prompt: string) { return serverProviderProxy.generate3PromptVariants(prompt, this.apiKey); }
  generateText(prompt: string, systemInstruction?: string) { return serverProviderProxy.enhancePrompt(systemInstruction ? `${systemInstruction}\n\n${prompt}` : prompt, this.apiKey); }
  analyzeImageForJson(imageDataUrl: string) { return serverProviderProxy.analyzeImageForJson(imageDataUrl, this.apiKey); }
}

export const enhancePromptWithAI = (prompt: string, apiKey?: string) => serverProviderProxy.enhancePrompt(prompt, apiKey);
export const editImageWithAI = (images: ImageInput[], prompt: string, resolution?: string, aspectRatio?: string, useGrounding?: boolean, preferredModel?: string) => new OpenRouterProvider(undefined, preferredModel).generateImage(images, prompt, resolution, aspectRatio, useGrounding);
export const analyzeImageForJsonWithAI = (imageDataUrl: string, apiKey?: string) => serverProviderProxy.analyzeImageForJson(imageDataUrl, apiKey);
export const analyzeStyleTransferWithAI = (referenceDataUrl: string, styleDataUrl: string, apiKey?: string) => serverProviderProxy.analyzeStyleTransfer(referenceDataUrl, styleDataUrl, undefined, apiKey);
