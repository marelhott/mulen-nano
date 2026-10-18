import { removeGeneratedLibraryImage } from './singleUserMediaStore';
import { deleteVariantsImage } from './variantsHistoryDB';
import { deleteCollageImage } from './collageHistoryDB';
import { notifyGeneratedImagesDeleted } from './generatedImageEvents';

/** Jedno ID označuje stejný výsledek ve všech sekcích; vstupní předlohy se nemažou. */
export async function removeGeneratedImageCopies(ids: string[]): Promise<void> {
  // Označení před lokálním úklidem brání pozdnímu zápisu rozpracovaného uložení.
  notifyGeneratedImagesDeleted(ids);
  for (const id of ids) {
    await Promise.all([removeGeneratedLibraryImage(id), deleteVariantsImage(id), deleteCollageImage(id)]);
  }
}
