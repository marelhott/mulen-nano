/**
 * Collections/Mood Boards — organizace obrázků do kolekcí.
 * Ukládá se lokálně v localStorage; dřívější cloudová synchronizace přes
 * Supabase byla odstraněna, protože projekt už běží jen na lokálním úložišti a R2.
 */


export interface Collection {
  id: string;
  name: string;
  description?: string;
  imageIds: string[];
  createdAt: number;
  updatedAt: number;
  color?: string;
  isPublic?: boolean;
  publicUrl?: string;
}

const STORAGE_KEY = 'nanoBanana_collections';

// Uložit kolekce do localStorage
function persist(collections: Collection[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(collections));
}

export class CollectionsDB {
  static getAll(): Collection[] {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    try {
      return JSON.parse(stored);
    } catch {
      return [];
    }
  }

  static getById(id: string): Collection | null {
    return this.getAll().find(c => c.id === id) || null;
  }

  static create(name: string, description?: string, color?: string): Collection {
    const collections = this.getAll();
    const newCollection: Collection = {
      id: `collection_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      description,
      imageIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      color,
    };
    collections.push(newCollection);
    persist(collections);
    return newCollection;
  }

  static update(id: string, updates: Partial<Omit<Collection, 'id' | 'createdAt'>>): void {
    const collections = this.getAll();
    const index = collections.findIndex(c => c.id === id);
    if (index !== -1) {
      collections[index] = { ...collections[index], ...updates, updatedAt: Date.now() };
      persist(collections);
    }
  }

  static delete(id: string): void {
    const collections = this.getAll().filter(c => c.id !== id);
    persist(collections);
  }

  static addImage(collectionId: string, imageId: string): void {
    const collections = this.getAll();
    const collection = collections.find(c => c.id === collectionId);
    if (collection && !collection.imageIds.includes(imageId)) {
      collection.imageIds.push(imageId);
      collection.updatedAt = Date.now();
      persist(collections);
    }
  }

  static removeImage(collectionId: string, imageId: string): void {
    const collections = this.getAll();
    const collection = collections.find(c => c.id === collectionId);
    if (collection) {
      collection.imageIds = collection.imageIds.filter(id => id !== imageId);
      collection.updatedAt = Date.now();
      persist(collections);
    }
  }

  static getCollectionsForImage(imageId: string): Collection[] {
    return this.getAll().filter(c => c.imageIds.includes(imageId));
  }

  static moveImage(imageId: string, fromCollectionId: string, toCollectionId: string): void {
    this.removeImage(fromCollectionId, imageId);
    this.addImage(toCollectionId, imageId);
  }

  static addImages(collectionId: string, imageIds: string[]): void {
    imageIds.forEach(imageId => this.addImage(collectionId, imageId));
  }

  static async setPublic(collectionId: string, isPublic: boolean): Promise<string | null> {
    const collection = this.getById(collectionId);
    if (!collection) return null;
    const publicUrl = isPublic ? `${window.location.origin}/shared/collection/${collectionId}` : undefined;
    this.update(collectionId, { isPublic, publicUrl });
    return publicUrl ?? null;
  }
}
