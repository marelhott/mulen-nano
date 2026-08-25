import React from 'react';
import { AIProviderType, ProviderSettings } from '../services/aiProvider';

interface ProviderSelectorProps { selectedProvider: AIProviderType; onChange: (provider: AIProviderType) => void; settings: ProviderSettings; }

export const ProviderSelector: React.FC<ProviderSelectorProps> = () => (
  <div className="relative">
    <label className="mb-1.5 block text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--text-secondary)]">AI gateway</label>
    <div className="control-surface px-3 py-2 text-[10px] font-semibold text-[var(--text-primary)]/78">OpenRouter</div>
  </div>
);
