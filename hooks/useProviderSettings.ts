import { useEffect, useMemo, useState } from 'react';
import { AIProviderType, ProviderSettings } from '../services/aiProvider';
import type { NanoBananaImageModel } from '../constants/timings';

const SETTINGS_KEY = 'providerSettings';
const MODEL_KEY = 'nanoBananaImageModel';

const defaults = (): ProviderSettings => ({
  [AIProviderType.OPENROUTER]: { apiKey: '', enabled: true },
  headSwap: { preferredPrimary: 'openrouter', hairSource: 'target', sourceGender: 'default', secondarySourceGender: 'default', useUpscale: true, useDetailer: false, facefusionEndpoint: '', refaceEndpoint: '' },
});

export function useProviderSettings() {
  const defaultProviderSettings = useMemo(defaults, []);
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>(defaultProviderSettings);
  const [nanoBananaImageModel, setNanoBananaImageModel] = useState<NanoBananaImageModel>('google/gemini-3-pro-image');

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
    const storedModel = localStorage.getItem(MODEL_KEY);
    if (storedModel) setNanoBananaImageModel(storedModel as NanoBananaImageModel);
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
