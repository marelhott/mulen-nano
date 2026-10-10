// Historie sekce Varianty: každý běh (předloha, prompt, modely, datum) a jeho hotové obrázky.
// Vlastní malá IndexedDB `mulenNanoVariants`, oddělená od sdílené knihovny aplikace, aby se
// nemigrovala `mulenNanoSingleUserLibrary`. Obrázky v plné velikosti a miniatury jsou ve
// dvou obchodech, takže výpis historie načítá jen miniatury.

import type { VariantModelId, VariantsDistance } from './variantsPlan';

const DB_NAME = 'mulenNanoVariants';
const DB_VERSION = 1;
const RUNS = 'runs';
const SOURCES = 'sources';
const IMAGES = 'images';
const THUMBS = 'thumbs';

export type VariantsRunRecord = {
  id: string;
  createdAt: number;
  sourceName: string;
  /** Malý náhled předlohy do výpisu. */
  sourceThumb: string;
  prompt: string;
  distance: VariantsDistance;
  models: VariantModelId[];
  countPerModel: number;
};

export type VariantsSourceRecord = { runId: string; dataUrl: string; mimeType: string };

export type VariantsImageRecord = {
  id: string;
  runId: string;
  modelId: VariantModelId;
  variantIndex: number;
  createdAt: number;
  dataUrl: string;
};

export type VariantsThumbRecord = Omit<VariantsImageRecord, 'dataUrl'> & { thumb: string };

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

export async function saveVariantsRun(run: VariantsRunRecord, source: VariantsSourceRecord): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([RUNS, SOURCES], 'readwrite');
  tx.objectStore(RUNS).put(run);
  tx.objectStore(SOURCES).put(source);
  await done(tx);
}

export async function saveVariantsImage(image: VariantsImageRecord, thumb: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([IMAGES, THUMBS], 'readwrite');
  tx.objectStore(IMAGES).put(image);
  const meta: Omit<VariantsImageRecord, "dataUrl"> & { dataUrl?: string } = { ...image };
  delete meta.dataUrl;
  tx.objectStore(THUMBS).put({ ...meta, thumb } satisfies VariantsThumbRecord);
  await done(tx);
}

/** Běhy od nejnovějšího; `before` = createdAt posledního už načteného běhu (stránkování). */
export async function listVariantsRuns(limit: number, before?: number): Promise<VariantsRunRecord[]> {
  const db = await openDb();
  const store = db.transaction(RUNS, 'readonly').objectStore(RUNS).index('createdAt');
  const range = before === undefined ? undefined : IDBKeyRange.upperBound(before, true);
  return await new Promise((resolve, reject) => {
    const runs: VariantsRunRecord[] = [];
    const request = store.openCursor(range, 'prev');
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || runs.length >= limit) {
        resolve(runs);
        return;
      }
      runs.push(cursor.value as VariantsRunRecord);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function listVariantsThumbs(runId: string): Promise<VariantsThumbRecord[]> {
  const db = await openDb();
  const records = await asPromise<VariantsThumbRecord[]>(
    db.transaction(THUMBS, 'readonly').objectStore(THUMBS).index('runId').getAll(IDBKeyRange.only(runId)),
  );
  return records.sort((a, b) => a.variantIndex - b.variantIndex);
}

export async function getVariantsImage(id: string): Promise<VariantsImageRecord | undefined> {
  const db = await openDb();
  return await asPromise<VariantsImageRecord | undefined>(db.transaction(IMAGES, 'readonly').objectStore(IMAGES).get(id));
}

export async function getVariantsSource(runId: string): Promise<VariantsSourceRecord | undefined> {
  const db = await openDb();
  return await asPromise<VariantsSourceRecord | undefined>(db.transaction(SOURCES, 'readonly').objectStore(SOURCES).get(runId));
}

export async function hasVariantsRun(runId: string): Promise<boolean> {
  const db = await openDb();
  return (await asPromise(db.transaction(RUNS, 'readonly').objectStore(RUNS).getKey(runId))) !== undefined;
}

export async function deleteVariantsRun(runId: string): Promise<void> {
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
