// Databanka: datový model a čisté změny indexu (bez I/O, testovatelné).
// Index je jeden JSON v R2; každá změna zvyšuje `rev`, podle něj se poznají souběžné úpravy.

export const BANK_INBOX_ID = 'inbox';

export type BankItemKind = 'image' | 'note' | 'prompt' | 'link';

export type BankFolder = { id: string; name: string; parentId: string | null; createdAt: number };

export type BankItem = {
  id: string;
  kind: BankItemKind;
  title: string;
  /** Text nápadu, prompt nebo poznámka k obrázku. */
  text?: string;
  /** Odkaz u položky typu `link`. */
  url?: string;
  itemKey?: string;
  thumbKey?: string;
  contentType?: string;
  size?: number;
  width?: number;
  height?: number;
  folderId: string;
  tags: string[];
  createdAt: number;
  /** Odkud položka přišla (např. soubor z počítače, název sekce). */
  source?: string;
  contentHash?: string;
  fileName?: string;
  galleryId?: string;
  generation?: { prompt: string; resolution?: string; aspectRatio?: string; params?: Record<string, unknown> };
};

export type BankIndex = { version: 1; rev: number; folders: BankFolder[]; items: BankItem[] };

export function emptyBankIndex(): BankIndex {
  return normalizeBankIndex({ version: 1, rev: 0, folders: [], items: [] });
}

/** Zajistí složku „Doručené“ a opraví položky, které ukazují na neexistující složku. */
export function normalizeBankIndex(index: BankIndex): BankIndex {
  const folders = index.folders.some((f) => f.id === BANK_INBOX_ID)
    ? index.folders
    : [{ id: BANK_INBOX_ID, name: 'Doručené', parentId: null, createdAt: 0 }, ...index.folders];
  const known = new Set(folders.map((f) => f.id));
  const items = index.items.some((item) => !known.has(item.folderId))
    ? index.items.map((item) => (known.has(item.folderId) ? item : { ...item, folderId: BANK_INBOX_ID }))
    : index.items;
  return { ...index, folders, items };
}

export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-').slice(0, 40);
}

export function parseTags(raw: string): string[] {
  return Array.from(new Set(raw.split(/[,\n]/).map(normalizeTag).filter(Boolean)));
}

export function addFolder(index: BankIndex, folder: { id: string; name: string; parentId: string | null }, now = Date.now()): BankIndex {
  const name = folder.name.trim();
  if (!name) return index;
  const parentId = index.folders.some((f) => f.id === folder.parentId) ? folder.parentId : null;
  return { ...index, folders: [...index.folders, { id: folder.id, name: name.slice(0, 80), parentId, createdAt: now }] };
}

export function renameFolder(index: BankIndex, id: string, name: string): BankIndex {
  const trimmed = name.trim();
  if (!trimmed || id === BANK_INBOX_ID) return index;
  return { ...index, folders: index.folders.map((f) => (f.id === id ? { ...f, name: trimmed.slice(0, 80) } : f)) };
}

/** Složka a všichni její potomci. */
export function folderSubtreeIds(index: BankIndex, id: string): Set<string> {
  const result = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of index.folders) {
      if (folder.parentId && result.has(folder.parentId) && !result.has(folder.id)) {
        result.add(folder.id);
        grew = true;
      }
    }
  }
  return result;
}

/** Smaže složku s podsložkami; jejich položky spadnou do nadřazené složky (u kořene do Doručených). */
export function deleteFolder(index: BankIndex, id: string): BankIndex {
  if (id === BANK_INBOX_ID) return index;
  const target = index.folders.find((f) => f.id === id);
  if (!target) return index;
  const doomed = folderSubtreeIds(index, id);
  const fallback = target.parentId ?? BANK_INBOX_ID;
  return {
    ...index,
    folders: index.folders.filter((f) => !doomed.has(f.id)),
    items: index.items.map((item) => (doomed.has(item.folderId) ? { ...item, folderId: fallback } : item)),
  };
}

/** Přesun složky pod jinou; nedovolí cyklus ani přesun Doručených. */
export function moveFolder(index: BankIndex, id: string, parentId: string | null): BankIndex {
  if (id === BANK_INBOX_ID || id === parentId) return index;
  if (parentId !== null && (folderSubtreeIds(index, id).has(parentId) || !index.folders.some((f) => f.id === parentId))) return index;
  return { ...index, folders: index.folders.map((f) => (f.id === id ? { ...f, parentId } : f)) };
}

export function addItem(index: BankIndex, item: BankItem): BankIndex {
  const folderId = index.folders.some((f) => f.id === item.folderId) ? item.folderId : BANK_INBOX_ID;
  return { ...index, items: [{ ...item, folderId, tags: Array.from(new Set(item.tags.map(normalizeTag).filter(Boolean))) }, ...index.items] };
}

/** Opakovaný upload nesmí vytvořit další kopii, ani když se dva klienti potkají při zápisu. */
export function findDuplicate(index: BankIndex, item: Pick<BankItem, 'contentHash' | 'galleryId'>): BankItem | undefined {
  return index.items.find((existing) => item.galleryId
    ? existing.galleryId === item.galleryId && existing.contentHash === item.contentHash
    : !!item.contentHash && existing.contentHash === item.contentHash);
}

export function updateItem(index: BankIndex, id: string, patch: Partial<Pick<BankItem, 'title' | 'text' | 'url' | 'folderId' | 'tags'>>): BankIndex {
  return {
    ...index,
    items: index.items.map((item) => {
      if (item.id !== id) return item;
      const next = { ...item, ...patch };
      if (patch.tags) next.tags = Array.from(new Set(patch.tags.map(normalizeTag).filter(Boolean)));
      if (patch.folderId && !index.folders.some((f) => f.id === patch.folderId)) next.folderId = item.folderId;
      return next;
    }),
  };
}

export function moveItems(index: BankIndex, ids: string[], folderId: string): BankIndex {
  if (!index.folders.some((f) => f.id === folderId)) return index;
  const set = new Set(ids);
  return { ...index, items: index.items.map((item) => (set.has(item.id) ? { ...item, folderId } : item)) };
}

export function removeItems(index: BankIndex, ids: string[]): { index: BankIndex; removed: BankItem[] } {
  const set = new Set(ids);
  return { index: { ...index, items: index.items.filter((item) => !set.has(item.id)) }, removed: index.items.filter((item) => set.has(item.id)) };
}

export type BankFilter = {
  /** `null` = všechno; jinak složka včetně podsložek. */
  folderId: string | null;
  tag?: string | null;
  query?: string;
  kind?: BankItemKind | null;
};

export function filterItems(index: BankIndex, filter: BankFilter): BankItem[] {
  const scope = filter.folderId === null ? null : folderSubtreeIds(index, filter.folderId);
  const query = (filter.query ?? '').trim().toLowerCase();
  return index.items
    .filter((item) => {
      if (scope && !scope.has(item.folderId)) return false;
      if (filter.tag && !item.tags.includes(filter.tag)) return false;
      if (filter.kind && item.kind !== filter.kind) return false;
      if (!query) return true;
      return [item.title, item.text ?? '', item.url ?? '', item.tags.join(' ')].join('\n').toLowerCase().includes(query);
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Štítky s počtem použití, nejčastější první. */
export function tagCounts(items: BankItem[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return Array.from(counts, ([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'cs'));
}

export function folderPath(index: BankIndex, id: string): BankFolder[] {
  const path: BankFolder[] = [];
  const seen = new Set<string>();
  let current = index.folders.find((f) => f.id === id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? index.folders.find((f) => f.id === current!.parentId) : undefined;
  }
  return path;
}
