import React from 'react';
import { IMAGE_MODELS, imageModelInputError, type ImageModelId } from '../constants/imageModels';
import type { ProviderSettings } from '../services/aiProvider';

type Selection = {
  model: ImageModelId;
  onChange: (model: ImageModelId) => void;
  settings: ProviderSettings;
  onSettingsChange: (settings: ProviderSettings) => void;
};
const Context = React.createContext<Selection | null>(null);
let serverConfiguration: Promise<Record<string, boolean> | null> | undefined;
export const ImageModelSelectionProvider = Context.Provider;
export function useImageModelSelection() {
  const value = React.useContext(Context);
  if (!value) throw new Error('Chybí společný kontext obrazových modelů.');
  return value;
}

export function ImageModelSelector(props: {
  inputCount?: number;
  selected?: string[];
  onSelect?: (model: ImageModelId) => void;
  disabled?: boolean;
}) {
  const selection = useImageModelSelection();
  const selected = props.selected ?? [selection.model];
  const [configured, setConfigured] = React.useState<Record<string, boolean> | null>(null);
  React.useEffect(() => {
    let active = true;
    serverConfiguration ??= fetch('/api/public-config').then(async (response) => response.ok ? await response.json() : null).catch(() => null);
    void serverConfiguration.then((value) => { if (active) setConfigured(value); });
    return () => { active = false; };
  }, []);
  return <section className="space-y-2" aria-label="Výběr obrazových modelů">
    <h3 className="mn-section-label">Výběr modelů</h3>
    <div className="grid grid-cols-2 gap-1">
      {IMAGE_MODELS.map((item, index) => {
        const reason = props.inputCount === undefined ? undefined : imageModelInputError(item.model, props.inputCount);
        const active = selected.includes(item.model);
        return <React.Fragment key={item.model}>
          {index === 9 && <hr className="col-span-2 my-1 border-[var(--border)]" />}
          <button type="button" aria-pressed={active} disabled={props.disabled || (!!reason && !active)}
            title={reason || item.model} onClick={() => (props.onSelect ?? selection.onChange)(item.model)}
            className={`mn-option-button mn-model-button min-w-0 disabled:opacity-40 disabled:cursor-not-allowed ${active ? 'mn-option-button-active' : ''}`}>
            <span>{item.title}</span>
          </button>
        </React.Fragment>;
      })}
    </div>
    {props.inputCount !== undefined && selected.map((model) => {
      const reason = imageModelInputError(model, props.inputCount!);
      return reason ? <p key={model} role="status" className="text-[10px] text-[var(--text-secondary)]">{reason}</p> : null;
    })}
    {configured && [...new Set(selected.map((model) => model.startsWith('venice/') ? 'venice' : 'openrouter'))].map((service) => {
      const local = selection.settings[service as 'venice' | 'openrouter']?.apiKey;
      if (local?.trim() || configured[service === 'openrouter' ? 'openRouter' : service]) return null;
      return <p key={service} role="status" className="text-[10px] text-[var(--text-secondary)]">Chybí klíč {service === 'openrouter' ? 'OpenRouter' : 'Venice'} v Nastavení i na serveru.</p>;
    })}
  </section>;
}
