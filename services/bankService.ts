// Klient Databanky (Cloudflare R2). Metadata žijí v jednom indexu, obrázky se nahrávají přímo do R2
// přes předpodepsané odkazy; server je jen podepisuje a hlídá přístup.

import { addItem, normalizeBankIndex, removeItems, type BankIndex, type BankItem } from '../utils/bankIndex';

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
    const parsed = JSON.parse(raw) as { token?: string; expiresAt?: number };
    return parsed.token && parsed.expiresAt && parsed.expiresAt > Date.now() ? parsed.token : '';
  } catch {
    return '';
  }
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
  const result = await call<{ token: string; expiresAt: number }>({ op: 'login', passphrase }, { auth: false });
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(result));
  } catch {
    throw new Error('Prohlížeč nedovolil uložit přihlášení.');
  }
}

export async function loadBankIndex(): Promise<BankIndex> {
  const { index } = await call<{ index: BankIndex }>({ op: 'index-get' });
  return normalizeBankIndex(index);
}

// Všechny zápisy jdou jedním řetězem, aby si vlastní souběžné změny nepřekážely.
let writeChain: Promise<unknown> = Promise.resolve();

/** Načte čerstvý index, aplikuje změnu a uloží; při souběhu s jiným klientem změnu zopakuje nad novějším stavem. */
export function mutateBank(mutator: (index: BankIndex) => BankIndex): Promise<BankIndex> {
  const run = async (): Promise<BankIndex> => {
    let current = await loadBankIndex();
    for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt += 1) {
      const next = normalizeBankIndex({ ...mutator(current), rev: current.rev + 1 });
      try {
        await call({ op: 'index-put', index: next });
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
    await call({ op: 'delete-objects', keys: valid.slice(i, i + URL_BATCH) });
  }
}

export async function uploadBankImage(file: File, opts: { folderId: string; tags?: string[]; source?: string }): Promise<BankItem> {
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
  };
  try {
    await mutateBank((index) => addItem(index, item));
  } catch (error) {
    void deleteBankObjects([slot.itemKey, slot.thumbKey]).catch(() => undefined);
    throw error;
  }
  return item;
}

export async function addBankEntry(item: BankItem): Promise<void> {
  await mutateBank((index) => addItem(index, item));
}

/** Smaže položky z indexu a až potom jejich soubory z R2 (neúspěšné mazání souborů index nerozbije). */
export async function deleteBankItems(ids: string[]): Promise<void> {
  let removed: BankItem[] = [];
  await mutateBank((index) => {
    const result = removeItems(index, ids);
    removed = result.removed;
    return result.index;
  });
  const keys = removed.flatMap((item) => [item.itemKey, item.thumbKey].filter((key): key is string => !!key));
  if (keys.length > 0) await deleteBankObjects(keys).catch(() => undefined);
}
