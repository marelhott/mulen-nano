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
  saveImage: vi.fn(),
  stored: vi.fn(),
  listRuns: vi.fn(),
  listThumbs: vi.fn(),
  image: vi.fn(),
  preview: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('../services/providerFactory', () => ({ ProviderFactory: { getProvider: () => ({ generateImage: mocks.generate }) } }));
vi.mock('../components/ImageModelSelection', () => ({ ImageModelSelector: () => null }));
vi.mock('../components/ImageComparisonModal', () => ({ ImageComparisonModal: (props: unknown) => { mocks.preview(props); return null; } }));
vi.mock('../components/styleTransfer/utils', () => ({
  fileToDataUrl: async (file: File) => `data:image/jpeg;base64,${file.name}`,
  resolveDropToFile: async () => null,
}));
vi.mock('./variantsInput', () => ({ optimizeVariantsInput: async (data: string, mimeType: string) => ({ data, mimeType }) }));
vi.mock('./galleryDB', () => ({ createThumbnail: async () => 'thumb', saveToGallery: async () => undefined }));
vi.mock('./imageDatabase', () => ({ ImageDatabase: { add: async () => undefined } }));
vi.mock('./variantsHistoryDB', () => ({
  listVariantsRuns: mocks.listRuns, listVariantsThumbs: mocks.listThumbs,
  saveVariantsRun: mocks.saveRun, saveVariantsImage: mocks.saveImage,
  deleteVariantsImage: vi.fn(), deleteVariantsRun: vi.fn(), getVariantsImage: mocks.image, getVariantsSource: mocks.stored,
}));
vi.mock('./collageHistoryDB', () => ({
  listCollageRuns: mocks.listRuns, listCollageThumbs: mocks.listThumbs,
  saveCollageRun: mocks.saveRun, saveCollageImage: mocks.saveImage,
  deleteCollageImage: vi.fn(), deleteCollageRun: vi.fn(), getCollageImage: mocks.image, getCollageSource: mocks.stored,
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
    mocks.listRuns.mockResolvedValue([]);
    mocks.listThumbs.mockResolvedValue([]);
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
    it(`${name}: výběr 11 souborů přijme 10 a generuje každý samostatně`, async () => {
      await act(async () => root.render(React.createElement(Screen, {
        providerSettings: {} as ProviderSettings, onOpenSettings: vi.fn(), onToast: mocks.toast,
      })));
      await upload(11);
      expect(container.querySelectorAll('img[title^="neutral-"]')).toHaveLength(10);
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
      await clickButton('Generovat');
      expect(mocks.generate).toHaveBeenCalledTimes(10);
      for (let i = 0; i < 10; i++) expect(mocks.generate.mock.calls[i][0]).toEqual([
        { data: `data:image/jpeg;base64,neutral-${i}.jpg`, mimeType: 'image/jpeg' },
      ]);
      const savedSource = mocks.saveRun.mock.calls[0][1];
      expect(savedSource.sources).toHaveLength(10);
    });

    it(`${name}: 10 vstupů × 9 modelů × 2 varianty = 180 oddělených požadavků`, async () => {
      const section = name === 'Varianty' ? 'variants' : 'collage';
      localStorage.setItem(`${section}.models`, 'nano-pro,gemini,gpt,flux,seedream,muse,grok,mai,recraft');
      localStorage.setItem(`${section}.count`, '2');
      await act(async () => root.render(React.createElement(Screen, {
        providerSettings: {} as ProviderSettings, onOpenSettings: vi.fn(), onToast: mocks.toast,
      })));
      await upload(10);
      expect([...container.querySelectorAll('button')].some((item) => item.textContent?.includes('Generovat 180'))).toBe(true);
      await clickButton('Generovat');
      expect(mocks.generate).toHaveBeenCalledTimes(180);
      for (let i = 0; i < 10; i++) {
        expect(mocks.generate.mock.calls.filter(([inputs]) => inputs.length === 1 && inputs[0].data === `data:image/jpeg;base64,neutral-${i}.jpg`)).toHaveLength(18);
        expect(mocks.saveImage.mock.calls.filter(([image]) => image.sourceIndex === i && image.sourceName === `neutral-${i}.jpg`)).toHaveLength(18);
      }
      expect(container.querySelectorAll('section[aria-label^="Vstup "]')).toHaveLength(10);
    });

    it(`${name}: ukáže důvod selhání hned, i když další úloha stále běží`, async () => {
      let finish!: (value: { imageBase64: string }) => void;
      const pending = new Promise<{ imageBase64: string }>((resolve) => { finish = resolve; });
      mocks.generate.mockRejectedValueOnce(new Error('Model odmítl vstupní obrázek.'))
        .mockImplementationOnce(() => pending);
      await act(async () => root.render(React.createElement(Screen, {
        providerSettings: {} as ProviderSettings, onOpenSettings: vi.fn(), onToast: mocks.toast,
      })));
      await upload(2);
      await clickButton('Generovat');
      try {
        expect(container.textContent).toContain('Model odmítl vstupní obrázek.');
        expect(container.textContent).toContain('Generuji');
      } finally {
        await act(async () => { finish({ imageBase64: 'generated-image' }); });
      }
    });

    it(`${name}: otevření historie porovná výsledek s jeho vlastním vstupem`, async () => {
      mocks.listRuns.mockResolvedValue([{ id: 'run', createdAt: 1, sourceName: 'first.jpg', sourceThumb: 'thumb',
        sourceNames: ['first.jpg', 'second.jpg'], sourceThumbs: ['thumb', 'thumb'], prompt: 'neutral', models: ['gpt'], countPerModel: 1 }]);
      mocks.listThumbs.mockResolvedValue([{ id: 'image', modelId: 'gpt', variantIndex: 0, sourceIndex: 1, sourceName: 'second.jpg', thumb: 'thumb', createdAt: 1 }]);
      mocks.image.mockResolvedValue({ dataUrl: 'generated' });
      mocks.stored.mockResolvedValue({ dataUrl: 'first-original', sources: [{ dataUrl: 'first-original' }, { dataUrl: 'second-original' }] });
      await act(async () => root.render(React.createElement(Screen, {
        providerSettings: {} as ProviderSettings, onOpenSettings: vi.fn(), onToast: mocks.toast,
      })));
      const card = container.querySelector('button.cursor-zoom-in') as HTMLButtonElement;
      await act(async () => card.click());
      expect(mocks.preview).toHaveBeenLastCalledWith(expect.objectContaining({ isOpen: true, originalImage: 'second-original', generatedImage: 'generated' }));
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
    expect(mocks.generate.mock.calls.at(-1)![0]).toEqual(original);
    expect(original).toHaveLength(1);
  });
});
