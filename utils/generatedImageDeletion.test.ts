// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { removeGeneratedImageCopies } from './generatedImageDeletion';
import { isGeneratedImageDeleted, subscribeToGeneratedImageDeletion } from './generatedImageEvents';
import { saveVariantsRun, saveVariantsImage, getVariantsImage, listVariantsThumbs, getVariantsSource } from './variantsHistoryDB';
import { saveCollageRun, saveCollageImage, getCollageImage } from './collageHistoryDB';
import { saveGeneratedLibraryImage, getGeneratedLibraryImageRecord } from './singleUserMediaStore';

afterEach(() => vi.unstubAllGlobals());

describe('Jednotné smazání výsledku', () => {
  it('odstraní stejné ID ze všech databází, ostatní varianty a předlohu zachová a oznámí změnu', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
    const removed = 'delete-integration-a';
    const retained = 'delete-integration-b';
    const runId = 'deletion-run';
    await saveVariantsRun({ id: runId, createdAt: 1, sourceName: 'source', sourceThumb: '', prompt: '', distance: 'middle', models: ['gpt'], countPerModel: 2 }, { runId, dataUrl: 'original', mimeType: 'image/png' });
    await saveCollageRun({ id: runId, createdAt: 1, sourceNames: ['source'], sourceThumbs: [], prompt: '', models: ['gpt'], countPerModel: 2 }, { runId, sources: [{ name: 'source', dataUrl: 'original', mimeType: 'image/png' }] });
    for (const [variantIndex, id] of [removed, retained].entries()) {
      const image = { id, runId, modelId: 'gpt' as const, variantIndex, createdAt: 1, dataUrl: 'generated' };
      await saveVariantsImage(image, 'thumb');
      await saveCollageImage(image, 'thumb');
      await saveGeneratedLibraryImage({ id, prompt: '', sourceUrl: 'generated', timestamp: 1 });
    }
    const listener = vi.fn();
    const unsubscribe = subscribeToGeneratedImageDeletion(listener);
    try { await removeGeneratedImageCopies([removed]); } finally { unsubscribe(); }
    expect(await getGeneratedLibraryImageRecord(removed)).toBeUndefined();
    expect(await getVariantsImage(removed)).toBeUndefined();
    expect(await getCollageImage(removed)).toBeUndefined();
    expect(await getVariantsImage(retained)).toBeDefined();
    expect(await getCollageImage(retained)).toBeDefined();
    expect((await getVariantsSource(runId))?.dataUrl).toBe('original');
    expect(listener).toHaveBeenCalledWith(new Set([removed]));
    expect(isGeneratedImageDeleted(removed)).toBe(true);
    // Opožděná odpověď nesmí obnovit smazanou historii.
    await saveVariantsImage({ id: removed, runId, modelId: 'gpt', variantIndex: 0, createdAt: 1, dataUrl: 'late' }, 'thumb');
    expect((await listVariantsThumbs(runId)).map((item) => item.id)).toEqual([retained]);
  });
});
