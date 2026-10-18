import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ list: vi.fn(), token: vi.fn(), index: vi.fn(), urls: vi.fn(), existing: vi.fn(), remove: vi.fn(), deleteBank: vi.fn(), wait: vi.fn(), blob: vi.fn(), save: vi.fn(), sync: vi.fn() }));
vi.mock('./singleUserMediaStore', () => ({ listGeneratedLibraryImages: mocks.list, getGeneratedLibraryImageRecord: mocks.existing, removeGeneratedLibraryImage: mocks.remove, clearGeneratedLibraryImages: vi.fn(), resolveBlobFromSource: mocks.blob, saveGeneratedLibraryImage: mocks.save }));
vi.mock('../services/bankService', () => ({ hasBankToken: mocks.token, loadBankIndex: mocks.index, getBankUrls: mocks.urls, deleteBankItems: mocks.deleteBank }));
vi.mock('./variantsHistoryDB', () => ({ deleteVariantsImage: vi.fn() }));
vi.mock('./collageHistoryDB', () => ({ deleteCollageImage: vi.fn() }));
vi.mock('../services/mediaSync', () => ({ mediaChanged: vi.fn(), syncGeneratedRecord: mocks.sync, waitForGeneratedSync: mocks.wait }));
import { notifyGeneratedImagesDeleted } from './generatedImageEvents';
import { deleteImage, getAllImages, saveToGallery } from './galleryDB';
beforeEach(() => {
  vi.clearAllMocks(); mocks.token.mockReturnValue(true); mocks.list.mockResolvedValue([]); mocks.index.mockResolvedValue({ items: [] }); mocks.urls.mockResolvedValue({ 'items/a.png': 'signed-original', 'thumbs/a.jpg': 'signed-thumb' }); mocks.deleteBank.mockResolvedValue(undefined);
});
describe('Společný feed', () => {
  it('zachová dvě různé varianty stejného promptu i setu bez automatického mazání', async () => {
    mocks.index.mockResolvedValue({ items: ['a', 'b'].map((id) => ({ id: `slot-${id}`, galleryId: id, kind: 'image', itemKey: 'items/a.png', createdAt: 10, generation: { prompt: 'pes', params: { runId: 'same-run' } } })) });
    expect((await getAllImages()).map((image) => image.id)).toEqual(['a', 'b']);
    expect(mocks.deleteBank).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('na novém zařízení obnoví originál, náhled, id i runId z R2', async () => {
    mocks.index.mockResolvedValue({ items: [{ id: 'remote-slot', galleryId: 'generated-a', kind: 'image', itemKey: 'items/a.png', thumbKey: 'thumbs/a.jpg', createdAt: 10, generation: { prompt: 'pes', params: { runId: 'run-a' } } }] });
    expect(await getAllImages()).toMatchObject([{ id: 'generated-a', url: 'signed-original', thumbnail: 'signed-thumb', timestamp: 10, params: { runId: 'run-a' } }]);
    expect(mocks.index).toHaveBeenCalledWith('feed');
  });
  it('nevrací cloudově smazané výsledky, ale zachová nesynchronizované lokální', async () => {
    mocks.list.mockResolvedValue([{ id: 'deleted', remoteStoragePath: 'r2:items/old.png', timestamp: 1 }, { id: 'pending', timestamp: 2 }]);
    expect((await getAllImages()).map((image) => image.id)).toEqual(['pending']);
  });
  it('při zamčení nekontaktuje R2 a nemaže lokální historii', async () => {
    mocks.token.mockReturnValue(false); mocks.list.mockResolvedValue([{ id: 'local' }]);
    expect((await getAllImages()).map((image) => image.id)).toEqual(['local']);
    expect(mocks.index).not.toHaveBeenCalled();
  });
  it('cloudový výsledek bez odemčení nelze pouze lokálně smazat a následně znovu obnovit', async () => {
    mocks.token.mockReturnValue(false); mocks.existing.mockResolvedValue({ remoteStoragePath: 'r2:items/a.png' });
    await expect(deleteImage('a')).rejects.toThrow('odemkni');
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('mazání počká na upload a odstraní cloudový i lokální záznam', async () => {
    mocks.index.mockResolvedValue({ items: [{ id: 'cloud-a', galleryId: 'a' }, { id: 'cloud-b', galleryId: 'b' }] });
    await deleteImage('a');
    expect(mocks.wait).toHaveBeenCalledWith('a');
    expect(mocks.deleteBank).toHaveBeenCalledWith(['cloud-a'], 'feed');
    expect(mocks.remove).toHaveBeenCalledWith('a');
  });
  it('smazání během přípravy obrázku zabrání pozdnímu uploadu do R2', async () => {
    let finish!: (blob: Blob) => void;
    mocks.blob.mockImplementationOnce(() => new Promise<Blob>((resolve) => { finish = resolve; }));
    mocks.save.mockResolvedValue({ id: 'late-in-flight', url: 'test' });
    const pending = saveToGallery({ id: 'late-in-flight', url: 'test', prompt: 'test' });
    notifyGeneratedImagesDeleted(['late-in-flight']);
    finish(new Blob(['test']));
    await pending;
    expect(mocks.remove).toHaveBeenCalledWith('late-in-flight');
    expect(mocks.sync).not.toHaveBeenCalled();
  });

});
