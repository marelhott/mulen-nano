import React, { useEffect, useState } from 'react';
import { AIProviderType, ProviderSettings } from '../services/aiProvider';

interface SettingsModalProps { isOpen: boolean; onClose: () => void; settings: ProviderSettings; onSave: (settings: ProviderSettings) => void; }

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, settings, onSave }) => {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/public-config').then((r) => r.json()).then((data) => setAvailable(Boolean(data?.openRouter))).catch(() => setAvailable(false));
  }, [isOpen]);
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-5" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-6 shadow-2xl">
        <h2 className="text-sm font-bold uppercase tracking-[0.18em]">Nastavení AI</h2>
        <p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">Aplikace používá výhradně serverovou gateway OpenRouter. Klíče se do prohlížeče neukládají ani neposílají.</p>
        <p className={`mt-3 text-xs ${available ? 'text-[var(--accent)]' : 'text-red-400'}`}>{available === null ? 'Ověřuji připojení…' : available ? 'OpenRouter je připraven.' : 'Na serveru chybí OPENROUTER_API_KEY.'}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button className="mn-option-button" onClick={() => { onSave({ ...settings, [AIProviderType.OPENROUTER]: { apiKey: '', enabled: true } }); onClose(); }}>Hotovo</button>
        </div>
      </div>
    </div>
  );
};
