import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { AIProviderType, ProviderSettings } from '../services/aiProvider';

interface SettingsModalProps { isOpen: boolean; onClose: () => void; settings: ProviderSettings; onSave: (settings: ProviderSettings) => void; }

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, settings, onSave }) => {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setApiKey(settings[AIProviderType.OPENROUTER]?.apiKey || '');
    setTestMessage(null);
    fetch('/api/public-config').then((r) => r.json()).then((data) => setAvailable(Boolean(data?.openRouter))).catch(() => setAvailable(false));
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const save = () => {
    onSave({ ...settings, [AIProviderType.OPENROUTER]: { apiKey: apiKey.trim(), enabled: true } });
    onClose();
  };

  const testKey = async () => {
    const key = apiKey.trim();
    if (!key) { setTestMessage(available ? 'Serverový klíč je připraven.' : 'Zadej OpenRouter API klíč.'); return; }
    setTesting(true);
    setTestMessage(null);
    try {
      const response = await fetch('/api/provider-key-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: key }) });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.success) {
        const nextSettings = { ...settings, [AIProviderType.OPENROUTER]: { apiKey: key, enabled: true } };
        onSave(nextSettings);
        localStorage.setItem('providerSettings', JSON.stringify(nextSettings));
        setTestMessage('Klíč je platný a uložený.');
      } else {
        setTestMessage(data?.error || 'Klíč se nepodařilo ověřit.');
      }
    } catch { setTestMessage('Klíč se nepodařilo ověřit.'); } finally { setTesting(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-5" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-6 shadow-2xl">
        <h2 className="text-sm font-bold uppercase tracking-[0.18em]">OpenRouter</h2>
        <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">Volitelný vlastní klíč se používá pouze pro tvoje requesty. Bez něj aplikace použije serverový klíč, pokud je nasazený.</p>
        <label className="mt-5 block text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-secondary)]" htmlFor="openrouter-key">API klíč</label>
        <div className="mt-2 flex gap-2">
          <input id="openrouter-key" type={showKey ? 'text' : 'password'} autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-or-v1-…" className="min-w-0 flex-1 rounded-lg border border-[var(--border-color)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--accent)]" />
          <button type="button" className="mn-option-button px-3" aria-label={showKey ? 'Skrýt klíč' : 'Zobrazit klíč'} onClick={() => setShowKey((value) => !value)}>{showKey ? <EyeOff size={15} /> : <Eye size={15} />}</button>
        </div>
        <p className={`mt-3 text-xs ${available ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}>{available === null ? 'Ověřuji server…' : available ? 'Serverový klíč je připraven.' : 'Serverový klíč není nasazený; použij vlastní klíč.'}</p>
        {testMessage && <p className="mt-2 text-xs text-[var(--text-secondary)]">{testMessage}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button className="mn-option-button" disabled={testing} onClick={testKey}>{testing ? <Loader2 className="animate-spin" size={14} /> : 'Ověřit'}</button>
          <button className="mn-option-button mn-option-button-active" onClick={save}>Uložit</button>
        </div>
      </div>
    </div>
  );
};
