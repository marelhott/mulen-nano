export const GENERATED_IMAGES_DELETED_EVENT = 'mulen:generated-images-deleted';
const DELETED_KEY = 'mulen:deleted-generated-images';
const deleted = new Set<string>();

export function isGeneratedImageDeleted(id: string): boolean {
  if (typeof window === 'undefined') return deleted.has(id);
  try {
    for (const value of JSON.parse(localStorage.getItem(DELETED_KEY) || '[]')) {
      if (typeof value === 'string') deleted.add(value);
    }
  } catch { /* Paměťová ochrana funguje i bez localStorage. */ }
  return deleted.has(id);
}

export function notifyGeneratedImagesDeleted(ids: string[]): void {
  if (!ids.length) return;
  isGeneratedImageDeleted(ids[0]);
  ids.forEach((id) => deleted.add(id));
  try { if (typeof window !== 'undefined') localStorage.setItem(DELETED_KEY, JSON.stringify([...deleted])); } catch { /* Úložiště může být plné. */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(GENERATED_IMAGES_DELETED_EVENT, { detail: ids }));
}

export function subscribeToGeneratedImageDeletion(listener: (ids: Set<string>) => void): () => void {
  const changed = (event: Event) => listener(new Set((event as CustomEvent<string[]>).detail));
  const storage = (event: StorageEvent) => {
    if (event.key !== DELETED_KEY || !event.newValue) return;
    try { listener(new Set(JSON.parse(event.newValue))); } catch { /* Neplatná událost. */ }
  };
  window.addEventListener(GENERATED_IMAGES_DELETED_EVENT, changed);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(GENERATED_IMAGES_DELETED_EVENT, changed);
    window.removeEventListener('storage', storage);
  };
}
