import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  token: vi.fn(), upload: vi.fn(), blob: vi.fn(), mark: vi.fn(), saved: vi.fn(), generated: vi.fn(),
}));
vi.mock('./bankService', () => ({ hasBankToken: mocks.token, uploadBankImage: mocks.upload, hashBankFile: vi.fn() }));
vi.mock('../utils/singleUserMediaStore', () => ({
  resolveBlobFromSource: mocks.blob, markGeneratedImageSynced: mocks.mark,
  listSavedLibraryImages: mocks.saved, listGeneratedLibraryImages: mocks.generated,
  getSavedLibraryImageRecord: vi.fn(), saveSavedLibraryImage: vi.fn(),
}));
import { compactRecipe, syncGeneratedRecord, syncLibraryToR2 } from './mediaSync';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('window', { dispatchEvent: vi.fn() });
  mocks.token.mockReturnValue(true); mocks.saved.mockResolvedValue([]); mocks.generated.mockResolvedValue([]);
  mocks.blob.mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
  mocks.upload.mockResolvedValue({ itemKey: 'items/test.png', thumbKey: 'thumbs/test.jpg' });
  mocks.mark.mockResolvedValue(undefined);
});
describe('Ukládání médií do R2', () => {
  it('neposílá obrázky a dočasné URL v receptu ani neodstraní runId', () => {
    expect(compactRecipe({ runId: 'run-1', prompt: 'pes', sourceImageUrls: ['data:large'], nested: { image: 'blob:temporary', value: 2 } })).toEqual({ runId: 'run-1', prompt: 'pes', nested: { value: 2 } });
  });
  it('bez přihlášení nezkouší upload ani jiného poskytovatele', async () => {
    mocks.token.mockReturnValue(false);
    await expect(syncGeneratedRecord({ id: 'a', url: 'blob:a', prompt: 'A', timestamp: 1 })).rejects.toThrow('Odemkni');
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('zachová id, čas a set generování v odděleném feedu', async () => {
    const image = { id: 'a', revision: 'version-1', url: 'blob:a', prompt: 'A', timestamp: 12, params: { section: 'Batch', runId: 'set-1' } };
    await syncGeneratedRecord(image);
    expect(mocks.upload.mock.calls[0][1]).toMatchObject({ space: 'feed', galleryId: 'a', createdAt: 12, source: 'Batch', generation: { prompt: 'A', params: { runId: 'set-1' } } });
    expect(mocks.mark).toHaveBeenCalledWith(image, 'items/test.png', 'thumbs/test.jpg');
  });
  it('souběžné editace stejného obrázku ukládá ve správném pořadí', async () => {
    let finish!: () => void;
    mocks.upload.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ itemKey: 'first', thumbKey: 'first-thumb' }); }));
    const first = syncGeneratedRecord({ id: 'same', url: 'blob:1', prompt: '1', timestamp: 1 });
    const second = syncGeneratedRecord({ id: 'same', url: 'blob:2', prompt: '2', timestamp: 1 });
    await vi.waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
    finish(); await Promise.all([first, second]);
    expect(mocks.upload.mock.calls.map((call) => call[1].generation.prompt)).toEqual(['1', '2']);
  });
  it('pokračuje po chybě jednoho souboru a přesto oznámí neúplnou synchronizaci', async () => {
    mocks.generated.mockResolvedValue([{ id: 'bad', url: 'a', prompt: '', timestamp: 1 }, { id: 'good', url: 'b', prompt: '', timestamp: 2 }]);
    mocks.upload.mockRejectedValueOnce(new Error('offline'));
    await expect(syncLibraryToR2()).rejects.toThrow('1 obrázků');
    expect(mocks.upload).toHaveBeenCalledTimes(2);
  });
});
