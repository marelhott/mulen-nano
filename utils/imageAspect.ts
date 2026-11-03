import { nearestAspectRatio } from './collagePlan';

/** Poměr stran obrázku z data URL, nejbližší podporovaný; při chybě 'Original'. */
export function readImageAspectRatio(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve('Original'), 1500);
    img.onload = () => { clearTimeout(timer); resolve(nearestAspectRatio(img.naturalWidth, img.naturalHeight)); };
    img.onerror = () => { clearTimeout(timer); resolve('Original'); };
    img.src = dataUrl;
  });
}
