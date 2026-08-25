import { GenerateImageResult, ImageInput } from './aiProvider';
import { defaultRetryPolicy } from '../utils/concurrencyRunner';

type ServerProviderAction =
  | 'enhancePrompt'
  | 'generateImage'
  | 'generate3PromptVariants'
  | 'analyzeImageForJson'
  | 'analyzeStyleTransfer';

type ServerProviderRequest = {
  action: ServerProviderAction;
  apiKey?: string;
  preferredModel?: string;
  images?: ImageInput[];
  prompt?: string;
  shortPrompt?: string;
  imageDataUrl?: string;
  referenceDataUrl?: string;
  styleDataUrl?: string;
  resolution?: string;
  aspectRatio?: string;
  useGrounding?: boolean;
  options?: { agenticVision?: boolean; mediaResolution?: string };
};

async function callServerProvider<T>(payload: ServerProviderRequest): Promise<T> {
  const retry = defaultRetryPolicy({ maxAttempts: 3, baseDelayMs: 800 });

  for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
    try {
      const response = await fetch('/api/provider-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const raw = await response.text();
      const data = (() => {
        try {
          return JSON.parse(raw);
        } catch {
          return {};
        }
      })();
      if (!response.ok || !data?.success) {
        throw new Error(
          data?.error ||
          raw?.slice(0, 400) ||
          response.statusText ||
          'Server provider request failed.'
        );
      }
      return data.result as T;
    } catch (error) {
      const canRetry = attempt < retry.maxAttempts && Boolean(retry.shouldRetry?.(error));
      if (!canRetry) throw error;
      const delayMs = (retry.baseDelayMs ?? 800) * attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error('Server provider request failed.');
}

export const serverProviderProxy = {
  enhancePrompt(shortPrompt: string, apiKey?: string): Promise<string> {
    return callServerProvider<string>({ action: 'enhancePrompt', shortPrompt, apiKey });
  },

  generateImage(params: {
    images: ImageInput[];
    prompt: string;
    resolution?: string;
    aspectRatio?: string;
    useGrounding?: boolean;
    preferredModel?: string;
    apiKey?: string;
  }): Promise<GenerateImageResult> {
    return callServerProvider<GenerateImageResult>({ action: 'generateImage', ...params });
  },

  generate3PromptVariants(prompt: string, apiKey?: string): Promise<Array<{ variant: string; approach: string; prompt: string }>> {
    return callServerProvider<Array<{ variant: string; approach: string; prompt: string }>>({
      action: 'generate3PromptVariants',
      prompt,
      apiKey,
    });
  },

  analyzeImageForJson(imageDataUrl: string, apiKey?: string): Promise<string> {
    return callServerProvider<string>({
      action: 'analyzeImageForJson',
      imageDataUrl,
      apiKey,
    });
  },

  analyzeStyleTransfer(
    referenceDataUrl: string,
    styleDataUrl: string,
    _options?: { agenticVision?: boolean; mediaResolution?: string },
    apiKey?: string
  ): Promise<{ recommendedStrength: number; styleDescription: string; negativePrompt: string }> {
    return callServerProvider<{ recommendedStrength: number; styleDescription: string; negativePrompt: string }>({
      action: 'analyzeStyleTransfer',
      referenceDataUrl,
      styleDataUrl,
      apiKey,
    });
  },
};
