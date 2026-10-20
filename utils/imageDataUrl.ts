// Převod obrázkových URL na data URL pro poskytovatele, kteří vyžadují inline base64.
// Původně žilo v utils/supabaseStorage.ts, ale se Supabase nesouvisí.

export async function urlToDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Obrázek se nepodařilo načíst (HTTP ${response.status}).`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) throw new Error('Adresa nevrátila obrázek.');
  const blob = await response.blob();

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Převod na data URL selhal.'));
    };
    reader.onerror = () => reject(new Error('Převod na data URL selhal.'));
    reader.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return await (await fetch(dataUrl)).blob();
}

export async function createThumbnailBlob(dataUrl: string, maxSize = 400): Promise<Blob> {
  return await new Promise<Blob>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Náhled se nepodařilo vytvořit.'));
      }, 'image/jpeg', 0.85);
    };
    img.onerror = () => reject(new Error('Náhled se nepodařilo načíst.'));
    img.src = dataUrl;
  });
}
