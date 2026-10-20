import { isGeneratedImageDeleted } from './generatedImageEvents';
import { createSingleUserId, readJsonStorage } from './singleUserStore';

export type SingleUserSavedImage = {
  id: string;
  url: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  timestamp: number;
  category: 'reference' | 'style' | 'asset';
  contentHash?: string;
  remoteStoragePath?: string;
};

export type SingleUserGeneratedImage = {
  id: string;
  revision?: string;
  url: string;
  prompt: string;
  timestamp: number;
  resolution?: string;
  aspectRatio?: string;
  thumbnail?: string;
  params?: any;
  versions?: Array<{ url: string; prompt: string; timestamp: number; recipe?: any }>;
  lineage?: { sourceImageIds: string[]; styleImageIds: string[]; sourceImageUrls: string[]; styleImageUrls: string[] };
  remoteStoragePath?: string;
  remoteThumbnailPath?: string;
};

type SavedRecord = Omit<SingleUserSavedImage, 'url'> & {
  blob?: Blob;
  sourceUrl?: string;
};

type GeneratedRecord = Omit<SingleUserGeneratedImage, 'url' | 'thumbnail'> & {
  blob?: Blob;
  sourceUrl?: string;
  thumbnailBlob?: Blob;
  thumbnailUrl?: string;
};

const DB_NAME = 'mulenNanoSingleUserLibrary';
const DB_VERSION = 1;
const SAVED_STORE = 'saved_images';
const GENERATED_STORE = 'generated_images';
const AUTO_BACKUP_KEY = 'nanoBanana_autoBackup';
const BACKUP_IMPORT_FLAG = 'mulenNano.singleUser.library.backupImported.v1';
let dbPromise: Promise<IDBDatabase> | null = null;
const objectUrlCache = new Map<string, string>();
let primedOnce = false;

function getCachedObjectUrl(key: string, blob?: Blob, fallbackUrl?: string): string {
  if (blob) {
    const existing = objectUrlCache.get(key);
    if (existing) return existing;
    const next = URL.createObjectURL(blob);
    objectUrlCache.set(key, next);
    return next;
  }

  return fallbackUrl || '';
}

function revokeObjectUrl(key: string): void {
  const existing = objectUrlCache.get(key);
  if (!existing) return;
  URL.revokeObjectURL(existing);
  objectUrlCache.delete(key);
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SAVED_STORE)) {
        db.createObjectStore(SAVED_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(GENERATED_STORE)) {
        db.createObjectStore(GENERATED_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
  });

  return dbPromise;
}

function runStoreRequest<T = void>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = operation(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(`IndexedDB request failed for ${storeName}`));
  }));
}

async function getAllRecords<T>(storeName: string): Promise<T[]> {
  const result = await runStoreRequest<T[]>(storeName, 'readonly', (store) => store.getAll());
  return Array.isArray(result) ? result : [];
}

async function getRecord<T>(storeName: string, id: string): Promise<T | undefined> {
  const result = await runStoreRequest<T | undefined>(storeName, 'readonly', (store) => store.get(id));
  return result;
}

async function putRecord<T>(storeName: string, record: T): Promise<void> {
  await runStoreRequest(storeName, 'readwrite', (store) => store.put(record));
}

async function deleteRecord(storeName: string, id: string): Promise<void> {
  await runStoreRequest(storeName, 'readwrite', (store) => store.delete(id));
}

async function clearStore(storeName: string): Promise<void> {
  await runStoreRequest(storeName, 'readwrite', (store) => store.clear());
}

async function fetchBlobFromUrl(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Nepodařilo se stáhnout obrázek (HTTP ${response.status})`);
  }
  return await response.blob();
}

async function primeFromAutoBackupIfNeeded(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (localStorage.getItem(BACKUP_IMPORT_FLAG)) return;

  const backup = readJsonStorage<any | null>(AUTO_BACKUP_KEY, null);
  if (!backup) {
    localStorage.setItem(BACKUP_IMPORT_FLAG, '1');
    return;
  }

  const savedList = await getAllRecords<SavedRecord>(SAVED_STORE);
  const generatedList = await getAllRecords<GeneratedRecord>(GENERATED_STORE);
  const savedIds = new Set(savedList.map((item) => item.id));
  const generatedIds = new Set(generatedList.map((item) => item.id));

  const backupGenerated = Array.isArray(backup.galleryImages) ? backup.galleryImages : [];
  for (const image of backupGenerated) {
    if (!image?.id || isGeneratedImageDeleted(image.id) || generatedIds.has(image.id) || !image.url) continue;

    await putRecord<GeneratedRecord>(GENERATED_STORE, {
      id: image.id,
      prompt: image.prompt || '',
      timestamp: Number(image.timestamp) || Date.now(),
      resolution: image.resolution,
      aspectRatio: image.aspectRatio,
      sourceUrl: image.url,
      thumbnailUrl: image.thumbnail,
      params: image.params,
      versions: image.versions,
      lineage: image.lineage,
    });
  }

  const backupSaved = Array.isArray(backup.savedImages) ? backup.savedImages : [];
  for (const image of backupSaved) {
    if (!image?.id || savedIds.has(image.id) || !image.url) continue;

    await putRecord<SavedRecord>(SAVED_STORE, {
      id: image.id,
      fileName: image.fileName || `${image.id}.jpg`,
      fileType: image.fileType || 'image/jpeg',
      fileSize: Number(image.fileSize) || 0,
      timestamp: Number(image.timestamp) || Date.now(),
      category: image.category || 'reference',
      sourceUrl: image.url,
    });
  }

  localStorage.setItem(BACKUP_IMPORT_FLAG, '1');
}

async function ensurePrimed(): Promise<void> {
  if (primedOnce) return;
  primedOnce = true;
  await primeFromAutoBackupIfNeeded();
}

/** Starý cloudový import byl odstraněn spolu se Supabase; data zůstávají lokálně a v R2. */
export async function importLegacyCloudLibrary(): Promise<boolean> {
  return false;
}

export async function listSavedLibraryImages(): Promise<SingleUserSavedImage[]> {
  await ensurePrimed();
  const records = await getAllRecords<SavedRecord>(SAVED_STORE);

  return records
    .map((record) => ({
      id: record.id,
      url: getCachedObjectUrl(`${SAVED_STORE}:${record.id}`, record.blob, record.sourceUrl),
      fileName: record.fileName,
      fileType: record.fileType,
      fileSize: record.fileSize,
      timestamp: record.timestamp,
      category: record.category,
      contentHash: record.contentHash,
      remoteStoragePath: record.remoteStoragePath,
    }))
    .sort((a, b) => b.timestamp - a.timestamp);
}

export async function listGeneratedLibraryImages(): Promise<SingleUserGeneratedImage[]> {
  await ensurePrimed();
  const records = await getAllRecords<GeneratedRecord>(GENERATED_STORE);

  return records
    .map((record) => ({
      id: record.id,
      url: getCachedObjectUrl(`${GENERATED_STORE}:${record.id}`, record.blob, record.sourceUrl),
      revision: record.revision,
      prompt: record.prompt,
      timestamp: record.timestamp,
      resolution: record.resolution,
      aspectRatio: record.aspectRatio,
      thumbnail: getCachedObjectUrl(`${GENERATED_STORE}:${record.id}:thumb`, record.thumbnailBlob, record.thumbnailUrl),
      params: record.params,
      versions: record.versions,
      lineage: record.lineage,
      remoteStoragePath: record.remoteStoragePath,
      remoteThumbnailPath: record.remoteThumbnailPath,
    }))
    .sort((a, b) => b.timestamp - a.timestamp);
}

export async function saveSavedLibraryImage(input: {
  id?: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  timestamp?: number;
  category: 'reference' | 'style' | 'asset';
  contentHash?: string;
  blob?: Blob;
  sourceUrl?: string;
  remoteStoragePath?: string;
}): Promise<SingleUserSavedImage> {
  const id = input.id || createSingleUserId('saved');

  await putRecord<SavedRecord>(SAVED_STORE, {
    id,
    fileName: input.fileName,
    fileType: input.fileType,
    fileSize: input.fileSize,
    timestamp: input.timestamp || Date.now(),
    category: input.category,
    contentHash: input.contentHash,
    blob: input.blob,
    sourceUrl: input.sourceUrl,
    remoteStoragePath: input.remoteStoragePath,
  });

  const record = await getRecord<SavedRecord>(SAVED_STORE, id);
  if (!record) {
    throw new Error('Saved image was not persisted locally');
  }

  return {
    id: record.id,
    url: getCachedObjectUrl(`${SAVED_STORE}:${record.id}`, record.blob, record.sourceUrl),
    fileName: record.fileName,
    fileType: record.fileType,
    fileSize: record.fileSize,
    timestamp: record.timestamp,
    category: record.category,
    contentHash: record.contentHash,
    remoteStoragePath: record.remoteStoragePath,
  };
}

export async function saveGeneratedLibraryImage(input: {
  id?: string;
  prompt: string;
  timestamp?: number;
  resolution?: string;
  aspectRatio?: string;
  blob?: Blob;
  sourceUrl?: string;
  thumbnailBlob?: Blob;
  thumbnailUrl?: string;
  params?: any;
  versions?: Array<{ url: string; prompt: string; timestamp: number; recipe?: any }>;
  lineage?: { sourceImageIds: string[]; styleImageIds: string[]; sourceImageUrls: string[]; styleImageUrls: string[] };
  remoteStoragePath?: string;
  remoteThumbnailPath?: string;
}): Promise<SingleUserGeneratedImage> {
  const id = input.id || createSingleUserId('generated');

  await putRecord<GeneratedRecord>(GENERATED_STORE, {
    id,
    revision: crypto.randomUUID(),
    prompt: input.prompt,
    timestamp: input.timestamp || Date.now(),
    resolution: input.resolution,
    aspectRatio: input.aspectRatio,
    blob: input.blob,
    sourceUrl: input.sourceUrl,
    thumbnailBlob: input.thumbnailBlob,
    thumbnailUrl: input.thumbnailUrl,
    params: input.params,
    versions: input.versions,
    lineage: input.lineage,
    remoteStoragePath: input.remoteStoragePath,
    remoteThumbnailPath: input.remoteThumbnailPath,
  });

  const record = await getRecord<GeneratedRecord>(GENERATED_STORE, id);
  if (!record) {
    throw new Error('Generated image was not persisted locally');
  }

  // Původní URL může stále používat Undo; nová verze ale musí dostat vlastní URL.
  objectUrlCache.delete(`${GENERATED_STORE}:${record.id}`);
  objectUrlCache.delete(`${GENERATED_STORE}:${record.id}:thumb`);

  return {
    id: record.id,
    revision: record.revision,
    url: getCachedObjectUrl(`${GENERATED_STORE}:${record.id}`, record.blob, record.sourceUrl),
    prompt: record.prompt,
    timestamp: record.timestamp,
    resolution: record.resolution,
    aspectRatio: record.aspectRatio,
    thumbnail: getCachedObjectUrl(`${GENERATED_STORE}:${record.id}:thumb`, record.thumbnailBlob, record.thumbnailUrl),
    params: record.params,
    versions: record.versions,
    lineage: record.lineage,
    remoteStoragePath: record.remoteStoragePath,
    remoteThumbnailPath: record.remoteThumbnailPath,
  };
}

export async function getSavedLibraryImageRecord(id: string): Promise<SavedRecord | undefined> {
  await ensurePrimed();
  return getRecord<SavedRecord>(SAVED_STORE, id);
}

/** Dokončený upload smí označit jen verzi, ze které vznikl, nikoli mezitím upravený obrázek. */
export async function markGeneratedImageSynced(image: SingleUserGeneratedImage, itemKey: string, thumbKey: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(GENERATED_STORE, 'readwrite');
    const store = tx.objectStore(GENERATED_STORE);
    const request = store.get(image.id);
    request.onsuccess = () => {
      const current = request.result as GeneratedRecord | undefined;
      if (current && current.revision === image.revision) store.put({ ...current, remoteStoragePath: `r2:${itemKey}`, remoteThumbnailPath: `r2:${thumbKey}` });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getGeneratedLibraryImageRecord(id: string): Promise<GeneratedRecord | undefined> {
  await ensurePrimed();
  return getRecord<GeneratedRecord>(GENERATED_STORE, id);
}

export async function removeSavedLibraryImage(id: string): Promise<void> {
  revokeObjectUrl(`${SAVED_STORE}:${id}`);
  await deleteRecord(SAVED_STORE, id);
}

export async function removeGeneratedLibraryImage(id: string): Promise<void> {
  revokeObjectUrl(`${GENERATED_STORE}:${id}`);
  revokeObjectUrl(`${GENERATED_STORE}:${id}:thumb`);
  await deleteRecord(GENERATED_STORE, id);
}

export async function clearSavedLibraryImages(): Promise<void> {
  const items = await getAllRecords<SavedRecord>(SAVED_STORE);
  for (const item of items) {
    revokeObjectUrl(`${SAVED_STORE}:${item.id}`);
  }
  await clearStore(SAVED_STORE);
}

export async function clearGeneratedLibraryImages(): Promise<void> {
  const items = await getAllRecords<GeneratedRecord>(GENERATED_STORE);
  for (const item of items) {
    revokeObjectUrl(`${GENERATED_STORE}:${item.id}`);
    revokeObjectUrl(`${GENERATED_STORE}:${item.id}:thumb`);
  }
  await clearStore(GENERATED_STORE);
}

export async function getSavedLibraryImageStats(): Promise<{ count: number; totalBytes: number }> {
  const items = await getAllRecords<SavedRecord>(SAVED_STORE);
  return {
    count: items.length,
    totalBytes: items.reduce((sum, item) => sum + Number(item.fileSize || 0), 0),
  };
}

export async function getGeneratedLibraryImageStats(): Promise<{ count: number; totalBytes: number }> {
  const items = await getAllRecords<GeneratedRecord>(GENERATED_STORE);
  return {
    count: items.length,
    totalBytes: items.reduce((sum, item) => {
      const blobBytes = item.blob?.size || 0;
      const thumbnailBytes = item.thumbnailBlob?.size || 0;
      return sum + blobBytes + thumbnailBytes;
    }, 0),
  };
}

export async function resolveBlobFromSource(url: string): Promise<Blob> {
  return fetchBlobFromUrl(url);
}
