import { AIProvider, AIProviderType, GenerateImageResult, ImageInput } from './aiProvider';
import { serverProviderProxy } from './serverProviderProxy';

export class OpenRouterProvider implements AIProvider {
  private readonly preferredImageModel: string;
  constructor(first?: string, second?: string) {
    this.preferredImageModel = second || first || 'google/gemini-3.1-flash-image-preview';
  }
  getName(): string { return 'OpenRouter'; }
  getType(): AIProviderType { return AIProviderType.OPENROUTER; }
  enhancePrompt(shortPrompt: string): Promise<string> { return serverProviderProxy.enhancePrompt(shortPrompt); }
  generateImage(images: ImageInput[], prompt: string, resolution?: string, aspectRatio?: string, useGrounding = false): Promise<GenerateImageResult> {
    return serverProviderProxy.generateImage({ images, prompt, resolution, aspectRatio, useGrounding, preferredModel: this.preferredImageModel });
  }
  generate3PromptVariants(prompt: string) { return serverProviderProxy.generate3PromptVariants(prompt); }
  generateText(prompt: string, systemInstruction?: string) { return serverProviderProxy.enhancePrompt(systemInstruction ? `${systemInstruction}\n\n${prompt}` : prompt); }
  analyzeImageForJson(imageDataUrl: string) { return serverProviderProxy.analyzeImageForJson(imageDataUrl); }
}

export const enhancePromptWithAI = (prompt: string, _unusedKey?: string) => serverProviderProxy.enhancePrompt(prompt);
export const editImageWithAI = (images: ImageInput[], prompt: string, resolution?: string, aspectRatio?: string, useGrounding?: boolean, preferredModel?: string) => new OpenRouterProvider(preferredModel).generateImage(images, prompt, resolution, aspectRatio, useGrounding);
export const analyzeImageForJsonWithAI = (imageDataUrl: string, _unusedKey?: string) => serverProviderProxy.analyzeImageForJson(imageDataUrl);
export const analyzeStyleTransferWithAI = (referenceDataUrl: string, styleDataUrl: string, _unusedKey?: string) => serverProviderProxy.analyzeStyleTransfer(referenceDataUrl, styleDataUrl);
