// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VariantsScreen } from '../components/VariantsScreen';
import { CollageScreen } from '../components/CollageScreen';
import type { ProviderSettings } from '../services/aiProvider';

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  saveRun: vi.fn(),
  stored: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('../services/providerFactory', () => ({ ProviderFactory: { getProvider: () => ({ generateImage: mocks.generate }) } }));
vi.mock('../components/ImageModelSelection', () => ({ ImageModelSelector: () => null }));
vi.mock('../components/ImageComparisonModal', () => ({ ImageComparisonModal: () => null }));
vi.mock('../components/styleTransfer/utils', () => ({
  fileToDataUrl: async (file: File) => `data:image/jpeg;base64,${file.name}`,
  resolveDropToFile: async () => null,
}));
vi.mock('./variantsInput', () => ({ optimizeVariantsInput: async (data: string, mimeType: string) => ({ data, mimeType }) }));
vi.mock('./galleryDB', () => ({ createThumbnail: async () => 'thumb', saveToGallery: async () => undefined }));
vi.mock('./imageDatabase', () => ({ ImageDatabase: { add: async () => undefined } }));
vi.mock('./variantsHistoryDB', () => ({
  listVariantsRuns: async () => [], listVariantsThumbs: async () => [],
  saveVariantsRun: mocks.saveRun, saveVariantsImage: async () => undefined,
  deleteVariantsImage: vi.fn(), deleteVariantsRun: vi.fn(), getVariantsImage: vi.fn(), getVariantsSource: mocks.stored,
}));
vi.mock('./collageHistoryDB', () => ({
  listCollageRuns: async () => [], listCollageThumbs: async () => [],
  saveCollageRun: mocks.saveRun, saveCollageImage: async () => undefined,
  deleteCollageImage: vi.fn(), deleteCollageRun: vi.fn(), getCollageImage: vi.fn(), getCollageSource: vi.fn(),
}));

let root: Root;
let container: HTMLDivElement;
async function upload(count: number) {
  const input = container.querySelector('input[type=file]') as HTMLInputElement;
  expect(input.multiple).toBe(true);
  const files = Array.from({ length: count }, (_, i) => new File(['photo'], `neutral-${i}.jpg`, { type: 'image/jpeg' }));
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function clickButton(text: string) {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.startsWith(text));
  expect(button).toBeDefined();
  await act(async () => { button!.click(); });
}

describe('víceobrázkové vstupy obrazovek', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    for (const section of ['variants', 'collage']) {
      localStorage.setItem(`${section}.models`, 'gpt');
      localStorage.setItem(`${section}.count`, '1');
    }
    mocks.generate.mockResolvedValue({ imageBase64: 'generated-image', modelId: 'openai/gpt-image-2.5-sunburst' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  for (const [name, Screen] of [['Varianty', VariantsScreen], ['Koláž', CollageScreen]] as const) {
    it(`${name}: výběr 11 souborů přijme 10 a odešle je všechny v jednom generování`, async () => {
      await act(async () => root.render(React.createElement(Screen, {
        providerSettings: {} as ProviderSettings, onOpenSettings: vi.fn(), onToast: mocks.toast,
      })));
      await upload(11);
      expect(container.querySelectorAll('img[title^="neutral-"]')).toHaveLength(10);
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
      await clickButton('Generovat');
      expect(mocks.generate).toHaveBeenCalledTimes(1);
      expect(mocks.generate.mock.calls[0][0]).toEqual(Array.from({ length: 10 }, (_, i) => ({
        data: `data:image/jpeg;base64,neutral-${i}.jpg`, mimeType: 'image/jpeg',
      })));
      const savedSource = mocks.saveRun.mock.calls[0][1];
      expect(savedSource.sources).toHaveLength(10);
    });
  }

  it('opakování variant použije původní sadu i po změně vstupního pole', async () => {
    mocks.generate.mockRejectedValueOnce(new Error('Model odmítl požadavek.'));
    await act(async () => root.render(React.createElement(VariantsScreen, {
      providerSettings: {} as ProviderSettings, onOpenSettings: vi.fn(), onToast: mocks.toast,
    })));
    await upload(3);
    await clickButton('Generovat');
    const original = mocks.generate.mock.calls[0][0];
    const remove = container.querySelector('button[title^="Odebrat"]') as HTMLButtonElement;
    await act(async () => remove.click());
    await clickButton('Retry');
    expect(mocks.generate.mock.calls[1][0]).toEqual(original);
    expect(original).toHaveLength(3);
  });
});
