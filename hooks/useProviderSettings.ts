import { useEffect, useMemo, useState } from 'react';
import { AIProviderType, ProviderSettings } from '../services/aiProvider';
import type { NanoBananaImageModel } from '../constants/timings';

const SETTINGS_KEY = 'providerSettings';
const MODEL_KEY = 'nanoBananaImageModel';
const LEGACY_FLASH_IMAGE_MODEL = 'google/gemini-3.1-flash-image';
const NANO_BANANA_2_1_MODEL: NanoBananaImageModel = 'google/gemini-nano-banana-2.1';
const LEGACY_GPT_IMAGE_MODEL = 'openai/gpt-5.4-image-2';
const GPT_IMAGE_2_5_MODEL: NanoBananaImageModel = 'openai/gpt-image-2.5-sunburst';
const SUPPORTED_IMAGE_MODELS: NanoBananaImageModel[] = [
  'google/gemini-3-pro-image',
  NANO_BANANA_2_1_MODEL,
  GPT_IMAGE_2_5_MODEL,
];

function readStoredImageModel(): NanoBananaImageModel {
  const storedModel = localStorage.getItem(MODEL_KEY);
  if (storedModel === LEGACY_GPT_IMAGE_MODEL) return GPT_IMAGE_2_5_MODEL;
  if (storedModel === LEGACY_FLASH_IMAGE_MODEL || storedModel === `${LEGACY_FLASH_IMAGE_MODEL}-preview`) {
    return NANO_BANANA_2_1_MODEL;
  }
  return SUPPORTED_IMAGE_MODELS.includes(storedModel as NanoBananaImageModel)
    ? storedModel as NanoBananaImageModel
    : 'google/gemini-3-pro-image';
}

const defaults = (): ProviderSettings => ({
  [AIProviderType.OPENROUTER]: { apiKey: '', enabled: true },
  headSwap: { preferredPrimary: 'openrouter', hairSource: 'target', sourceGender: 'default', secondarySourceGender: 'default', useUpscale: true, useDetailer: false, facefusionEndpoint: '', refaceEndpoint: '' },
});

export function useProviderSettings() {
  const defaultProviderSettings = useMemo(defaults, []);
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>(defaultProviderSettings);
  const [nanoBananaImageModel, setNanoBananaImageModel] = useState<NanoBananaImageModel>(readStoredImageModel);

  useEffect(() => {
    // Migrujeme pouze jediný OpenRouter klíč; historické provider klíče se zahodí.
    try {
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') as ProviderSettings;
      const existing = stored[AIProviderType.OPENROUTER];
      if (existing?.apiKey) {
        setProviderSettings({ ...defaultProviderSettings, [AIProviderType.OPENROUTER]: { apiKey: existing.apiKey, enabled: true } });
      }
    } catch {
      localStorage.removeItem(SETTINGS_KEY);
    }
  }, [defaultProviderSettings]);

  useEffect(() => localStorage.setItem(MODEL_KEY, nanoBananaImageModel), [nanoBananaImageModel]);
  useEffect(() => localStorage.setItem(SETTINGS_KEY, JSON.stringify(providerSettings)), [providerSettings]);
  return {
    defaultProviderSettings,
    providerSettings,
    selectedProvider: AIProviderType.OPENROUTER,
    nanoBananaImageModel,
    setProviderSettings,
    setSelectedProvider: (_provider: AIProviderType) => undefined,
    setNanoBananaImageModel,
  };
}
