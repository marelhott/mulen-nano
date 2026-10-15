import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadBankImage } from './bankService';
import { emptyBankIndex } from '../utils/bankIndex';

function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 100, height: 100, close: vi.fn() }));
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage: vi.fn() }), toBlob: (done: (blob: Blob) => void) => done(new Blob(['thumbnail'], { type: 'image/jpeg' })) }) });
});
afterEach(() => vi.unstubAllGlobals());

describe('Souběžné nahrávání do knihovny', () => {
  it.each([false, true])('spustí oba PUT najednou a vyčká na oba před zápisem nebo úklidem (chyba: %s)', async (fail) => {
    const original = deferred(), thumb = deferred();
    let published = false, cleaned = false;
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (url === 'https://upload.test/original') return original.promise;
      if (url === 'https://upload.test/thumb') return thumb.promise;
      const payload = JSON.parse(String(init.body));
      if (payload.op === 'index-get') return Response.json({ index: emptyBankIndex() });
      if (payload.op === 'upload-url') return Response.json({ id: 'one', itemKey: 'items/one', thumbKey: 'thumbs/one', itemUrl: 'https://upload.test/original', thumbUrl: 'https://upload.test/thumb' });
      if (payload.op === 'index-put') { published = true; return Response.json({ ok: true }); }
      if (payload.op === 'delete-objects') { cleaned = true; return Response.json({ failed: 0 }); }
      throw new Error('Neočekávaný požadavek');
    });
    vi.stubGlobal('fetch', fetch);
    const job = uploadBankImage(new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }), { folderId: 'inbox' });
    const outcome = job.then((item) => ({ item, error: undefined }), (error: Error) => ({ item: undefined, error }));
    await vi.waitFor(() => expect(fetch.mock.calls.filter(([url]) => url.startsWith('https://upload.test/'))).toHaveLength(2));
    expect(published).toBe(false);
    original.resolve(new Response('', { status: fail ? 500 : 200 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cleaned).toBe(false);
    expect(published).toBe(false);
    thumb.resolve(new Response('', { status: 200 }));
    const result = await outcome;
    if (fail) {
      expect(result.error?.message).toContain('HTTP 500');
      await vi.waitFor(() => expect(cleaned).toBe(true));
      expect(published).toBe(false);
    } else {
      expect(result.item?.id).toBe('one');
      expect(published).toBe(true);
      expect(cleaned).toBe(false);
    }
  });
});
