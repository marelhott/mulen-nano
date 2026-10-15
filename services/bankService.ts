// Klient Databanky (Cloudflare R2). Metadata žijí v jednom indexu, obrázky se nahrávají přímo do R2
// přes předpodepsané odkazy; server je jen podepisuje a hlídá přístup.

import { addItem, findDuplicate, normalizeBankIndex, removeItems, type BankIndex, type BankItem } from '../utils/bankIndex';
import { listSavedLibraryImages, removeGeneratedLibraryImage, removeSavedLibraryImage } from '../utils/singleUserMediaStore';

export type BankSpace = 'library' | 'feed';
export const BANK_CHANGED_EVENT = 'mulen:bank-changed';
export const BANK_AUTH_EVENT = 'mulen:bank-auth';

function notify(name: string): void {
  window.dispatchEvent(new Event(name));
}

const TOKEN_KEY = 'bank.token';
const URL_TTL_MS = 50 * 60 * 1000;
const URL_BATCH = 200;
const MAX_CONFLICT_RETRIES = 4;
const THUMB_SIZE = 360;

export class BankAuthError extends Error {
  constructor(message = 'Přihlášení do Databanky vypršelo.') {
    super(message);
    this.name = 'BankAuthError';
  }
}

export type BankStatus = { configured: boolean; missing: string[] };

function readToken(): string {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { token?: string; expiresAt?: number | null };
    return typeof parsed.token === 'string' && (parsed.expiresAt === null || (typeof parsed.expiresAt === 'number' && parsed.expiresAt > Date.now())) ? parsed.token : '';
  } catch {
    return '';
  }
}

/** Platný přihlašovací token (sdílí ho Databanka i podepisování R2 odkazů), nebo prázdný řetězec. */
export function getBankToken(): string {
  return readToken();
}

export function hasBankToken(): boolean {
  return readToken().length > 0;
}

export function bankLogout(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // úložiště může být zakázané
  }
  urlCache.clear();
  notify(BANK_AUTH_EVENT);
}

async function call<T>(payload: Record<string, unknown>, opts: { auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.auth !== false) {
    const token = readToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch('/api/bank', { method: 'POST', headers, body: JSON.stringify(payload) });
  const text = await response.text();
  let data: any = {};
  try {
    data = JSON.parse(text);
  } catch {
    // odpověď není JSON (např. chyba platformy)
  }
  if (response.status === 401 && payload.op !== 'login') {
    bankLogout();
    throw new BankAuthError();
  }
  if (!response.ok) {
    const error: Error & { status?: number; data?: any } = new Error(String(data?.error || `Databanka selhala (HTTP ${response.status}).`));
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data as T;
}

export async function bankStatus(): Promise<BankStatus> {
  return await call<BankStatus>({ op: 'status' }, { auth: false });
}

export async function bankLogin(passphrase: string): Promise<void> {
  const result = await call<{ token: string; expiresAt: number | null }>({ op: 'login', passphrase }, { auth: false });
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(result));
  } catch {
    throw new Error('Prohlížeč nedovolil uložit přihlášení.');
  }
  notify(BANK_AUTH_EVENT);
}

export async function rememberBankSession(): Promise<void> {
  if (!readToken()) return;
  const saved = JSON.parse(localStorage.getItem(TOKEN_KEY) || '{}');
  if (saved.expiresAt === null) return;
  const result = await call<{ token: string; expiresAt: null }>({ op: 'session' });
  localStorage.setItem(TOKEN_KEY, JSON.stringify(result));
}

export async function loadBankIndex(space: BankSpace = 'library'): Promise<BankIndex> {
  const { index } = await call<{ index: BankIndex }>({ op: 'index-get', space });
  return normalizeBankIndex(index);
}

// Všechny zápisy jdou jedním řetězem, aby si vlastní souběžné změny nepřekážely.
let writeChain: Promise<unknown> = Promise.resolve();

/** Načte čerstvý index, aplikuje změnu a uloží; při souběhu s jiným klientem změnu zopakuje nad novějším stavem. */
export function mutateBank(mutator: (index: BankIndex) => BankIndex, space: BankSpace = 'library'): Promise<BankIndex> {
  const run = async (): Promise<BankIndex> => {
    let current = await loadBankIndex(space);
    for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt += 1) {
      const next = normalizeBankIndex({ ...mutator(current), rev: current.rev + 1 });
      try {
        await call({ op: 'index-put', index: next, space });
        notify(BANK_CHANGED_EVENT);
        return next;
      } catch (error: any) {
        if (error?.status !== 409 || !error.data?.index || attempt === MAX_CONFLICT_RETRIES) throw error;
        current = normalizeBankIndex(error.data.index as BankIndex);
      }
    }
    throw new Error('Databanku se nepodařilo uložit.');
  };
  const result = writeChain.then(run, run);
  writeChain = result.catch(() => undefined);
  return result;
}

// --- podepsané odkazy ---------------------------------------------------------------------------

const urlCache = new Map<string, { url: string; expiresAt: number }>();

export function getCachedBankUrl(key: string | undefined): string | undefined {
  if (!key) return undefined;
  const hit = urlCache.get(key);
  return hit && hit.expiresAt > Date.now() ? hit.url : undefined;
}

export async function getBankUrls(keys: string[], opts: { force?: boolean } = {}): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const missing: string[] = [];
  for (const key of new Set(keys)) {
    const cached = opts.force ? undefined : getCachedBankUrl(key);
    if (cached) result[key] = cached;
    else missing.push(key);
  }
  for (let i = 0; i < missing.length; i += URL_BATCH) {
    const batch = missing.slice(i, i + URL_BATCH);
    const { urls } = await call<{ urls: Record<string, string> }>({ op: 'download-urls', keys: batch });
    for (const [key, url] of Object.entries(urls)) {
      urlCache.set(key, { url, expiresAt: Date.now() + URL_TTL_MS });
      result[key] = url;
    }
  }
  return result;
}

// --- nahrávání a mazání -------------------------------------------------------------------------

async function loadBitmap(file: Blob): Promise<ImageBitmap> {
  return await createImageBitmap(file);
}

async function makeThumbnail(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await loadBitmap(file);
  try {
    const scale = Math.min(1, THUMB_SIZE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Nepodařilo se vytvořit náhled.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob) throw new Error('Nepodařilo se vytvořit náhled.');
    return { blob, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

async function putObject(url: string, body: Blob, contentType: string): Promise<void> {
  const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body });
  if (!response.ok) throw new Error(`Nahrání do úložiště selhalo (HTTP ${response.status}). Zkontroluj CORS pravidla bucketu.`);
}

export async function deleteBankObjects(keys: string[]): Promise<void> {
  const valid = keys.filter(Boolean);
  for (let i = 0; i < valid.length; i += URL_BATCH) {
    const result = await call<{ failed: number }>({ op: 'delete-objects', keys: valid.slice(i, i + URL_BATCH) });
    if (result.failed) throw new Error('Část souborů se nepodařilo odstranit z R2.');
  }
}

export async function hashBankFile(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function uploadBankImage(file: File, opts: {
  folderId: string; tags?: string[]; source?: string; space?: BankSpace;
  galleryId?: string; generation?: BankItem['generation']; createdAt?: number;
}): Promise<BankItem & { reused?: boolean }> {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('Podporované obrázky: JPEG, PNG, WebP a GIF.');
  if (!file.size || file.size > 40 * 1024 * 1024) throw new Error('Obrázek musí být menší než 40 MB.');
  const contentHash = await hashBankFile(file);
  const current = await loadBankIndex(opts.space);
  const duplicate = findDuplicate(current, { contentHash, galleryId: opts.galleryId });
  if (duplicate) return { ...duplicate, reused: true };
  const { blob: thumb, width, height } = await makeThumbnail(file);
  const slot = await call<{ id: string; itemKey: string; thumbKey: string; itemUrl: string; thumbUrl: string }>({
    op: 'upload-url',
    contentType: file.type,
    size: file.size,
  });
  try {
    await putObject(slot.itemUrl, file, file.type);
    await putObject(slot.thumbUrl, thumb, 'image/jpeg');
  } catch (error) {
    void deleteBankObjects([slot.itemKey, slot.thumbKey]).catch(() => undefined);
    throw error;
  }
  const item: BankItem = {
    id: slot.id,
    kind: 'image',
    title: file.name.replace(/\.[^.]+$/, '') || 'Obrázek',
    itemKey: slot.itemKey,
    thumbKey: slot.thumbKey,
    contentType: file.type,
    size: file.size,
    width,
    height,
    folderId: opts.folderId,
    tags: opts.tags ?? [],
    createdAt: Date.now(),
    source: opts.source ?? 'počítač',
    contentHash,
    fileName: file.name,
    galleryId: opts.galleryId,
    generation: opts.generation,
  };
  item.createdAt = opts.createdAt ?? item.createdAt;
  let retained = item;
  let replaced: BankItem[] = [];
  try {
    await mutateBank((index) => {
      const existing = findDuplicate(index, item);
      if (existing) {
        retained = existing;
        return index;
      }
      retained = item;
      // Nová editace stejného výsledku nahradí jeho předchozí verzi ve feedu.
      replaced = item.galleryId ? index.items.filter((entry) => entry.galleryId === item.galleryId) : [];
      const base = item.galleryId ? { ...index, items: index.items.filter((entry) => entry.galleryId !== item.galleryId) } : index;
      return addItem(base, item);
    }, opts.space);
  } catch (error) {
    void deleteBankObjects([slot.itemKey, slot.thumbKey]).catch(() => undefined);
    throw error;
  }
  if (retained.id !== item.id) {
    await deleteBankObjects([slot.itemKey, slot.thumbKey]).catch(() => undefined);
    return { ...retained, reused: true };
  }
  const oldKeys = replaced.flatMap((entry) => [entry.itemKey, entry.thumbKey].filter((key): key is string => Boolean(key)));
  if (oldKeys.length) await deleteBankObjects(oldKeys).catch(() => undefined);
  return item;
}

export async function addBankEntry(item: BankItem): Promise<void> {
  await mutateBank((index) => addItem(index, item));
}

/** Smaže položky z indexu a až potom jejich soubory z R2 (neúspěšné mazání souborů index nerozbije). */
export async function deleteBankItems(ids: string[], space: BankSpace = 'library'): Promise<void> {
  if (!ids.length) return;
  let removed: BankItem[] = [];
  await mutateBank((index) => {
    const result = removeItems(index, ids);
    removed = result.removed;
    return result.index;
  }, space);
  if (space === 'feed') {
    for (const item of removed) if (item.galleryId) await removeGeneratedLibraryImage(item.galleryId);
  } else {
    const saved = await listSavedLibraryImages();
    for (const image of saved) {
      if (removed.some((item) => (Boolean(item.contentHash) && item.contentHash === image.contentHash) || (Boolean(item.itemKey) && `r2:${item.itemKey}` === image.remoteStoragePath))) await removeSavedLibraryImage(image.id);
    }
  }
  const keys = removed.flatMap((item) => [item.itemKey, item.thumbKey].filter((key): key is string => !!key));
  if (keys.length > 0) await deleteBankObjects(keys);
}
