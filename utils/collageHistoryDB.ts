import { isGeneratedImageDeleted } from './generatedImageEvents';
// Historie sekce Koláž: každý běh (vstupy, prompt, modely, datum) a jeho hotové obrázky.
// Vlastní malá IndexedDB `mulenNanoCollage`, oddělená od sdílené knihovny aplikace, aby se
// nemigrovala `mulenNanoSingleUserLibrary`. Obrázky v plné velikosti a miniatury jsou ve
// dvou obchodech, takže výpis historie načítá jen miniatury.

import type { VariantModelId } from './variantsPlan';

const DB_NAME = 'mulenNanoCollage';
const DB_VERSION = 1;
const RUNS = 'runs';
const SOURCES = 'sources';
const IMAGES = 'images';
const THUMBS = 'thumbs';

export type CollageRunRecord = {
  id: string;
  createdAt: number;
  /** Názvy vstupních obrázků. */
  sourceNames: string[];
  /** Malé náhledy vstupů do výpisu. */
  sourceThumbs: string[];
  prompt: string;
  models: VariantModelId[];
  countPerModel: number;
};

export type CollageSourceRecord = { runId: string; sources: Array<{ name: string; dataUrl: string; mimeType: string }> };

export type CollageImageRecord = {
  sourceIndex?: number;
  sourceName?: string;
  id: string;
  runId: string;
  modelId: VariantModelId;
  variantIndex: number;
  createdAt: number;
  dataUrl: string;
};

export type CollageThumbRecord = Omit<CollageImageRecord, 'dataUrl'> & { thumb: string };

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RUNS)) db.createObjectStore(RUNS, { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      if (!db.objectStoreNames.contains(SOURCES)) db.createObjectStore(SOURCES, { keyPath: 'runId' });
      if (!db.objectStoreNames.contains(IMAGES)) db.createObjectStore(IMAGES, { keyPath: 'id' }).createIndex('runId', 'runId');
      if (!db.objectStoreNames.contains(THUMBS)) db.createObjectStore(THUMBS, { keyPath: 'id' }).createIndex('runId', 'runId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('Nepodařilo se otevřít historii Variant.'));
    };
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Zápis do historie Variant selhal.'));
    tx.onabort = () => reject(tx.error ?? new Error('Zápis do historie Variant byl přerušen.'));
  });
}

function asPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveCollageRun(run: CollageRunRecord, source: CollageSourceRecord): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([RUNS, SOURCES], 'readwrite');
  tx.objectStore(RUNS).put(run);
  tx.objectStore(SOURCES).put(source);
  await done(tx);
}

export async function saveCollageImage(image: CollageImageRecord, thumb: string): Promise<void> {
  if (isGeneratedImageDeleted(image.id)) return;
  const db = await openDb();
  const tx = db.transaction([IMAGES, THUMBS], 'readwrite');
  tx.objectStore(IMAGES).put(image);
  const meta: Omit<CollageImageRecord, "dataUrl"> & { dataUrl?: string } = { ...image };
  delete meta.dataUrl;
  tx.objectStore(THUMBS).put({ ...meta, thumb } satisfies CollageThumbRecord);
  await done(tx);
}

/** Běhy od nejnovějšího; `before` = createdAt posledního už načteného běhu (stránkování). */
export async function listCollageRuns(limit: number, before?: number): Promise<CollageRunRecord[]> {
  const db = await openDb();
  const store = db.transaction(RUNS, 'readonly').objectStore(RUNS).index('createdAt');
  const range = before === undefined ? undefined : IDBKeyRange.upperBound(before, true);
  return await new Promise((resolve, reject) => {
    const runs: CollageRunRecord[] = [];
    const request = store.openCursor(range, 'prev');
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || runs.length >= limit) {
        resolve(runs);
        return;
      }
      runs.push(cursor.value as CollageRunRecord);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function listCollageThumbs(runId: string): Promise<CollageThumbRecord[]> {
  const db = await openDb();
  const records = await asPromise<CollageThumbRecord[]>(
    db.transaction(THUMBS, 'readonly').objectStore(THUMBS).index('runId').getAll(IDBKeyRange.only(runId)),
  );
  return records.filter((image) => !isGeneratedImageDeleted(image.id)).sort((a, b) => a.variantIndex - b.variantIndex);
}

export async function getCollageImage(id: string): Promise<CollageImageRecord | undefined> {
  const db = await openDb();
  return await asPromise<CollageImageRecord | undefined>(db.transaction(IMAGES, 'readonly').objectStore(IMAGES).get(id));
}

export async function getCollageSource(runId: string): Promise<CollageSourceRecord | undefined> {
  const db = await openDb();
  return await asPromise<CollageSourceRecord | undefined>(db.transaction(SOURCES, 'readonly').objectStore(SOURCES).get(runId));
}

export async function deleteCollageRun(runId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([RUNS, SOURCES, IMAGES, THUMBS], 'readwrite');
  tx.objectStore(RUNS).delete(runId);
  tx.objectStore(SOURCES).delete(runId);
  for (const name of [IMAGES, THUMBS]) {
    const store = tx.objectStore(name);
    const request = store.index('runId').openKeyCursor(IDBKeyRange.only(runId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
  }
  await done(tx);
}

/** Smaže jeden obrázek; když v běhu nezůstane žádný, zmizí i celý běh (včetně předlohy). */
export async function deleteCollageImage(id: string): Promise<{ runDeleted: boolean }> {
  const db = await openDb();
  const thumb = await asPromise<CollageThumbRecord | undefined>(db.transaction(THUMBS, 'readonly').objectStore(THUMBS).get(id));
  const tx = db.transaction([IMAGES, THUMBS], 'readwrite');
  tx.objectStore(IMAGES).delete(id);
  tx.objectStore(THUMBS).delete(id);
  await done(tx);
  if (!thumb) return { runDeleted: false };
  const left = await asPromise<number>(db.transaction(THUMBS, 'readonly').objectStore(THUMBS).index('runId').count(IDBKeyRange.only(thumb.runId)));
  if (left > 0) return { runDeleted: false };
  await deleteCollageRun(thumb.runId);
  return { runDeleted: true };
}
