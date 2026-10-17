import { imageModelById, type ImageModelId } from '../constants/imageModels';
import { AIProviderType, type ProviderSettings } from './aiProvider';
import { ProviderFactory } from './providerFactory';

export type ImageExecution = { model: ImageModelId; settings: ProviderSettings };

// Starší nástroje dostanou stejný uložený výběr; nikdy nepevný náhradní model.
export function readImageExecution(): ImageExecution {
  try {
    const stored = localStorage.getItem('nanoBananaImageModel') || '';
    return {
      model: imageModelById(stored)?.model ?? 'google/gemini-3-pro-image',
      settings: JSON.parse(localStorage.getItem('providerSettings') || '{}'),
    };
  } catch {
    return { model: 'google/gemini-3-pro-image', settings: {} };
  }
}

export function imageExecutionProvider(execution = readImageExecution()) {
  return ProviderFactory.getProvider(AIProviderType.OPENROUTER, execution.settings, execution.model);
}
