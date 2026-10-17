// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useProviderSettings } from '../hooks/useProviderSettings';

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  vi.unstubAllGlobals();
});

it('StrictMode nepřepíše uložené klíče, AIR, sílu ani vybraný externí model', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  });
  localStorage.setItem(
    'providerSettings',
    JSON.stringify({
      openrouter: { apiKey: 'or-test', enabled: true },
      venice: { apiKey: 'venice-test', enabled: true },
      runware: {
        apiKey: 'runware-test',
        enabled: true,
        model: 'civitai:1@2',
        strength: 0.27,
      },
    })
  );
  localStorage.setItem(
    'nanoBananaImageModel',
    'venice/qwen-image-2-1-pro-edit'
  );
  const root = createRoot(document.createElement('div'));
  let current: ReturnType<typeof useProviderSettings>;
  function Probe() {
    current = useProviderSettings();
    return null;
  }
  cleanup = () => act(() => root.unmount());
  await act(async () => {
    root.render(
      React.createElement(React.StrictMode, null, React.createElement(Probe))
    );
  });
  expect(current!.providerSettings.venice?.apiKey).toBe('venice-test');
  // Uložené nastavení zrušené služby (Runware) se nenačítá.
  expect('runware' in current!.providerSettings).toBe(false);
  expect(current!.nanoBananaImageModel).toBe('venice/qwen-image-2-1-pro-edit');
  expect(
    JSON.parse(localStorage.getItem('providerSettings')!).openrouter.apiKey
  ).toBe('or-test');
});
