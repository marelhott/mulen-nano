import React from 'react';
import type { NanoBananaImageModel } from '../constants/timings';
import { QWEN_EDIT_MODELS } from '../constants/externalImageModels';
import type { ProviderSettings } from '../services/aiProvider';

export function ExternalImageModels({
  model,
  onChange,
  settings,
  onSettingsChange,
}: {
  model: NanoBananaImageModel;
  onChange: (model: NanoBananaImageModel) => void;
  settings: ProviderSettings;
  onSettingsChange: (settings: ProviderSettings) => void;
}) {
  const qwen = QWEN_EDIT_MODELS.find((item) => item.model === model);
  const [lastQwen, setLastQwen] = React.useState<NanoBananaImageModel>(
    'venice/qwen-edit-uncensored'
  );
  const selectQwen = (value: NanoBananaImageModel) => {
    setLastQwen(value);
    onChange(value);
  };
  const button = (active: boolean) =>
    `mn-option-button w-full ${active ? 'mn-option-button-active' : ''}`;
  return (
    <div className="mt-4 space-y-2 border-t border-[var(--border-color)] pt-4">
      <button
        type="button"
        aria-pressed={Boolean(qwen)}
        className={button(Boolean(qwen))}
        onClick={() => selectQwen(qwen?.model || lastQwen)}
      >
        Qwen Edit
      </button>
      <div
        className="grid grid-cols-3 gap-1"
        role="group"
        aria-label="Varianta Qwen"
      >
        {QWEN_EDIT_MODELS.map((item) => (
          <button
            key={item.model}
            type="button"
            aria-pressed={model === item.model}
            className={button(model === item.model)}
            onClick={() => selectQwen(item.model)}
          >
            {item.title}
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-pressed={model === 'runware/sdxl'}
        className={button(model === 'runware/sdxl')}
        onClick={() => onChange('runware/sdxl')}
      >
        Runware · SDXL
      </button>
      {model === 'runware/sdxl' && (
        <label className="block py-2 text-xs text-[var(--text-secondary)]">
          Síla změny · {Math.round((settings.runware?.strength ?? 0.35) * 100)}{' '}
          %
          <input
            aria-label="Síla změny Runware"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={settings.runware?.strength ?? 0.35}
            onChange={(event) =>
              onSettingsChange({
                ...settings,
                runware: {
                  apiKey: settings.runware?.apiKey || '',
                  enabled: true,
                  ...settings.runware,
                  strength: Number(event.target.value),
                },
              })
            }
            className="mt-2 block w-full accent-[var(--accent)]"
          />
        </label>
      )}
      <button
        type="button"
        aria-pressed={model === 'venice/lustify-v8'}
        className={button(model === 'venice/lustify-v8')}
        onClick={() => onChange('venice/lustify-v8')}
      >
        Lustify v8 · pouze text
      </button>
    </div>
  );
}
