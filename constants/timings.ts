import { AIProviderType } from '../services/aiProvider';

export type NanoBananaImageModel = 'google/gemini-3-pro-image' | 'google/gemini-3.1-flash-image' | 'openai/gpt-5.4-image-2';

const GEMINI_FLASH_INTER_REQUEST_DELAY_MS = 250;
const GEMINI_PRO_INTER_REQUEST_DELAY_MS = 450;
const CHAT_PROVIDER_INTER_REQUEST_DELAY_MS = 200;
const DEFAULT_INTER_REQUEST_DELAY_MS = 150;
const GEMINI_RETRY_BASE_BACKOFF_MS = 12_000;
const DEFAULT_RETRY_BASE_BACKOFF_MS = 6_000;

export function getInterRequestDelayMs(
  provider: AIProviderType,
  imageModel: NanoBananaImageModel,
  imageIndex: number
): number {
  if (imageIndex <= 0) return 0;

  if (provider === AIProviderType.OPENROUTER) {
    return imageModel === 'google/gemini-3-pro-image'
      ? GEMINI_PRO_INTER_REQUEST_DELAY_MS
      : GEMINI_FLASH_INTER_REQUEST_DELAY_MS;
  }

  if (provider === AIProviderType.OPENROUTER || provider === AIProviderType.OPENROUTER) {
    return CHAT_PROVIDER_INTER_REQUEST_DELAY_MS;
  }

  return DEFAULT_INTER_REQUEST_DELAY_MS;
}

export function getRetryBackoffMs(provider: AIProviderType, retryCount: number): number {
  const baseDelay = provider === AIProviderType.OPENROUTER
    ? GEMINI_RETRY_BASE_BACKOFF_MS
    : DEFAULT_RETRY_BASE_BACKOFF_MS;

  return baseDelay * Math.pow(2, retryCount - 1);
}
