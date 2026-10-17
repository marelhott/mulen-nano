// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ImageModelSelector, ImageModelSelectionProvider } from '../components/ImageModelSelection';
import { IMAGE_MODELS, type ImageModelId } from '../constants/imageModels';

afterEach(() => vi.unstubAllGlobals());

it('společný selector skutečně přepíná všech 13 modelů přesným ID', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ openRouter: true, venice: true })));
  const selected = vi.fn();
  function Harness() {
    const [model, setModel] = useState<ImageModelId>('google/gemini-3-pro-image');
    return React.createElement(ImageModelSelectionProvider, { value: {
      model, onChange: (next) => { selected(next); setModel(next); }, settings: {}, onSettingsChange: () => {},
    } }, React.createElement(ImageModelSelector));
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(React.createElement(Harness)));
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons).toHaveLength(13);
    for (const [index, model] of IMAGE_MODELS.entries()) {
      await act(async () => buttons[index].click());
      expect(selected).toHaveBeenLastCalledWith(model.model);
      expect(buttons[index].getAttribute('aria-pressed')).toBe('true');
      expect(host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
    }
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
