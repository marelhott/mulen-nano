import { removeGeneratedImageCopies } from './generatedImageDeletion';
import { isGeneratedImageDeleted } from './generatedImageEvents';
import { clearGeneratedLibraryImages, getGeneratedLibraryImageRecord, listGeneratedLibraryImages, resolveBlobFromSource, saveGeneratedLibraryImage, type SingleUserGeneratedImage } from './singleUserMediaStore';
import { dispatchCloudSyncEvent } from './cloudSyncEvents';
import { deleteBankItems, getBankUrls, hasBankToken, loadBankIndex } from '../services/bankService';
import { mediaChanged, syncGeneratedRecord, waitForGeneratedSync } from '../services/mediaSync';

export interface GalleryImage extends SingleUserGeneratedImage {}

type SaveToGalleryInput = Omit<GalleryImage, 'id' | 'timestamp'> & {
  id?: string;
  timestamp?: number;
};

export const saveToGallery = async (image: SaveToGalleryInput): Promise<void> => {
  if (image.id && isGeneratedImageDeleted(image.id)) return;
  let mainBlob: Blob | undefined;
  let thumbBlob: Blob | undefined;

  try {
    if (image.url) {
      mainBlob = await resolveBlobFromSource(image.url);
    }
  } catch (error) {
    console.warn('[Gallery] Failed to persist full image blob locally, falling back to URL only:', error);
  }

  try {
    if (image.thumbnail) {
      thumbBlob = await resolveBlobFromSource(image.thumbnail);
    }
  } catch (error) {
    console.warn('[Gallery] Failed to persist thumbnail blob locally, falling back to URL only:', error);
  }

  const localRecord = await saveGeneratedLibraryImage({
    id: image.id,
    prompt: image.prompt,
    timestamp: image.timestamp,
    resolution: image.resolution,
    aspectRatio: image.aspectRatio,
    blob: mainBlob,
    sourceUrl: mainBlob ? undefined : image.url,
    thumbnailBlob: thumbBlob,
    thumbnailUrl: thumbBlob ? undefined : image.thumbnail,
    params: image.params,
    versions: image.versions,
    lineage: image.lineage,
  });

  if (isGeneratedImageDeleted(localRecord.id)) {
    await removeGeneratedImageCopies([localRecord.id]);
    return;
  }
  mediaChanged();
  void syncGeneratedRecord(localRecord).catch(() => {
    dispatchCloudSyncEvent({ status: 'failed', resource: 'generated-image', message: 'Výsledek je uložený lokálně. Odemkni knihovnu nebo obnov spojení pro dokončení uložení do R2.' });
  });
};

export const getAllImages = async (): Promise<GalleryImage[]> => {
  try {
    const local = (await listGeneratedLibraryImages()).filter((image) => !isGeneratedImageDeleted(image.id));
    if (!hasBankToken()) return local;
    try {
      const index = await loadBankIndex('feed');
      const items = index.items.filter((item) => item.kind === 'image' && item.galleryId && item.itemKey && item.generation);
      const urls = await getBankUrls(items.flatMap((item) => [item.itemKey!, item.thumbKey!]).filter(Boolean));
      const remoteIds = new Set(items.map((item) => item.galleryId));
      const removed = local.filter((image) => image.remoteStoragePath?.startsWith('r2:') && !remoteIds.has(image.id));
      if (removed.length) await removeGeneratedImageCopies(removed.map((image) => image.id));
      const merged = new Map(local.filter((image) => !image.remoteStoragePath?.startsWith('r2:') || remoteIds.has(image.id)).map((image) => [image.id, image]));
      for (const item of items) {
        if (isGeneratedImageDeleted(item.galleryId!)) continue;
        const existing = merged.get(item.galleryId!);
        if (existing && (!existing.remoteStoragePath?.startsWith('r2:') || existing.remoteStoragePath === `r2:${item.itemKey}`)) continue;
        merged.set(item.galleryId!, {
          id: item.galleryId!, url: urls[item.itemKey!], thumbnail: urls[item.thumbKey!],
          prompt: item.generation!.prompt, timestamp: item.createdAt,
          resolution: item.generation!.resolution, aspectRatio: item.generation!.aspectRatio,
          params: item.generation!.params, remoteStoragePath: `r2:${item.itemKey}`, remoteThumbnailPath: `r2:${item.thumbKey}`,
        });
      }
      return [...merged.values()].filter((image) => !isGeneratedImageDeleted(image.id)).sort((a, b) => b.timestamp - a.timestamp);
    } catch {
      dispatchCloudSyncEvent({ status: 'failed', resource: 'generated-image', message: 'R2 feed není dostupný. Zobrazuji lokální historii.' });
      return local.filter((image) => !isGeneratedImageDeleted(image.id));
    }
  } catch (error) {
    console.error('Error loading gallery:', error);
    return [];
  }
};

export const deleteImage = async (id: string): Promise<void> => {
  await waitForGeneratedSync(id);
  const existing = await getGeneratedLibraryImageRecord(id);
  if (hasBankToken()) {
    const index = await loadBankIndex('feed');
    await deleteBankItems(index.items.filter((item) => item.galleryId === id).map((item) => item.id), 'feed');
  } else if (existing?.remoteStoragePath?.startsWith('r2:')) {
    throw new Error('Pro smazání z R2 odemkni knihovnu.');
  }
  await removeGeneratedImageCopies([id]);
  mediaChanged();
};

export const clearGallery = async (): Promise<void> => {
  const all = await getAllImages();
  for (const image of all) await deleteImage(image.id);
  await clearGeneratedLibraryImages();
  mediaChanged();
};

export const createThumbnail = (dataUrl: string, maxSize: number = 400): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxSize) {
          height = (height * maxSize) / width;
          width = maxSize;
        }
      } else if (height > maxSize) {
        width = (width * maxSize) / height;
        height = maxSize;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);
      }
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('Nepodařilo se načíst obrázek pro thumbnail.'));
    img.src = dataUrl;
  });
};
