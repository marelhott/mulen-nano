import {
  getSavedLibraryImageRecord, listSavedLibraryImages, listGeneratedLibraryImages,
  resolveBlobFromSource, saveSavedLibraryImage, markGeneratedImageSynced,
  type SingleUserSavedImage, type SingleUserGeneratedImage,
} from '../utils/singleUserMediaStore';
import { BANK_INBOX_ID } from '../utils/bankIndex';
import { hashBankFile, hasBankToken, uploadBankImage } from './bankService';
import { dispatchCloudSyncEvent } from '../utils/cloudSyncEvents';

export const MEDIA_CHANGED_EVENT = 'mulen:media-changed';
export const isR2Path = (path?: string) => Boolean(path?.startsWith('r2:'));
export const r2Key = (path: string) => path.slice(3);

export function mediaChanged(): void {
  window.dispatchEvent(new Event(MEDIA_CHANGED_EVENT));
}

// Recept zůstává použitelný, ale binární obrázky ani dočasné URL nepatří do indexu.
export function compactRecipe(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return JSON.parse(JSON.stringify(value, (key, entry) => {
    if (['lineage', 'maskData', 'sourceImageUrls', 'styleImageUrls', 'assetImageUrls'].includes(key)) return undefined;
    if (typeof entry === 'string' && /^(data:|blob:)/.test(entry)) return undefined;
    return entry;
  }));
}

const generatedJobs = new Map<string, Promise<void>>();
const uploadSlots: Promise<unknown>[] = Array.from({ length: 3 }, () => Promise.resolve());
let nextSlot = 0;

function scheduleUpload<T>(work: () => Promise<T>): Promise<T> {
  const slot = nextSlot++ % uploadSlots.length;
  const job = uploadSlots[slot].catch(() => undefined).then(work);
  uploadSlots[slot] = job.catch(() => undefined);
  return job;
}

export function syncGeneratedRecord(image: SingleUserGeneratedImage): Promise<void> {
  const job = (generatedJobs.get(image.id) || Promise.resolve()).catch(() => undefined).then(() => scheduleUpload(() => uploadGeneratedRecord(image)));
  generatedJobs.set(image.id, job);
  void job.finally(() => { if (generatedJobs.get(image.id) === job) generatedJobs.delete(image.id); }).catch(() => undefined);
  return job;
}

export async function waitForGeneratedSync(id: string): Promise<void> {
  await generatedJobs.get(id)?.catch(() => undefined);
}

async function uploadGeneratedRecord(image: SingleUserGeneratedImage): Promise<void> {
  if (!hasBankToken()) throw new Error('Odemkni knihovnu pro uložení výsledku do R2.');
  const blob = await resolveBlobFromSource(image.url);
  const ext = blob.type.split('/')[1] || 'png';
  const item = await uploadBankImage(new File([blob], `${image.id}.${ext}`, { type: blob.type }), {
    folderId: BANK_INBOX_ID, space: 'feed', galleryId: image.id,
    source: String(image.params?.section || image.params?.operation || 'generování'),
    createdAt: image.timestamp,
    generation: { prompt: image.prompt, resolution: image.resolution, aspectRatio: image.aspectRatio, params: compactRecipe(image.params) },
  });
  await markGeneratedImageSynced(image, item.itemKey!, item.thumbKey!);
  mediaChanged();
}

async function syncSourceRecord(image: SingleUserSavedImage): Promise<SingleUserSavedImage> {
  return scheduleUpload(async () => {
    if (!hasBankToken()) throw new Error('Odemkni knihovnu pro uložení zdroje do R2.');
    const blob = await resolveBlobFromSource(image.url);
    const item = await uploadBankImage(new File([blob], image.fileName, { type: image.fileType || blob.type }), { folderId: BANK_INBOX_ID });
    return saveSavedLibraryImage({ ...image, blob, contentHash: item.contentHash, remoteStoragePath: `r2:${item.itemKey}` });
  });
}

const sourceJobs = new Map<string, Promise<SingleUserSavedImage>>();

export async function archiveSourceFile(file: File, category: SingleUserSavedImage['category'] = 'reference'): Promise<SingleUserSavedImage> {
  const hash = await hashBankFile(file);
  const active = sourceJobs.get(hash);
  if (active) return active;
  const job = (async () => {
    const id = `source-${hash}`;
    const existing = await getSavedLibraryImageRecord(id);
    let record = await saveSavedLibraryImage({
      id, fileName: existing?.fileName || file.name, fileType: file.type,
      fileSize: file.size, timestamp: existing?.timestamp, category: existing?.category || category,
      contentHash: hash, blob: file, remoteStoragePath: existing?.remoteStoragePath,
    });
    if (hasBankToken() || !isR2Path(record.remoteStoragePath)) {
      try { record = await syncSourceRecord(record); }
      catch {
        dispatchCloudSyncEvent({ status: 'failed', resource: 'saved-image', message: 'Zdroj je uložený lokálně. Odemkni knihovnu nebo obnov spojení pro dokončení uložení do R2.' });
      }
    }
    mediaChanged();
    return record;
  })();
  sourceJobs.set(hash, job);
  try { return await job; } finally { sourceJobs.delete(hash); }
}

let syncJob: Promise<void> | undefined;

/** Lokální kopie funguje i offline; po odemčení či návratu připojení se doplní chybějící R2 zápisy. */
export function syncLibraryToR2(): Promise<void> {
  if (syncJob) return syncJob;
  if (!hasBankToken()) return Promise.resolve();
  syncJob = (async () => {
    let failed = 0;
    const saved = await listSavedLibraryImages();
    for (const image of saved) if (!isR2Path(image.remoteStoragePath)) {
      try { await syncSourceRecord(image); } catch { failed += 1; }
    }
    const generated = await listGeneratedLibraryImages();
    for (const image of generated) if (!isR2Path(image.remoteStoragePath)) {
      try { await syncGeneratedRecord(image); } catch { failed += 1; }
    }
    mediaChanged();
    if (failed) throw new Error(`${failed} obrázků zatím nebylo možné synchronizovat.`);
  })().finally(() => { syncJob = undefined; });
  return syncJob;
}
