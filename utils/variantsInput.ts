// Příprava vstupního obrázku pro Varianty: zmenšení a JPEG kvalita tak, aby tělo požadavku
// zůstalo pod limitem serveru (Express 6 MB). Stejné chování jako `optimizeBatchInputDataUrl`
// v BatchScreen; je to kopie, aby se obrazovka Varianty nenačítala spolu s Batch.
// Na rozdíl od Batch se volá JEDNOU za běh (z jedné předlohy jde až 30 úloh).

async function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Nepodařilo se načíst vstupní obrázek.'));
    img.src = dataUrl;
  });
}

export async function optimizeVariantsInput(
  dataUrl: string,
  mimeType: string,
): Promise<{ data: string; mimeType: string }> {
  const originalBytes = Math.ceil((dataUrl.length * 3) / 4);
  const targetBytes = 1_100_000;
  const maxDimension = 1400;

  if (originalBytes <= targetBytes && !mimeType.includes('png')) {
    return { data: dataUrl, mimeType };
  }

  const image = await loadImageElement(dataUrl);
  const longestSide = Math.max(image.width, image.height);
  const scale = longestSide > maxDimension ? maxDimension / longestSide : 1;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));

  const ctx = canvas.getContext('2d');
  if (!ctx) return { data: dataUrl, mimeType };

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  let quality = 0.86;
  let output = canvas.toDataURL('image/jpeg', quality);
  while (quality > 0.56 && Math.ceil((output.length * 3) / 4) > targetBytes) {
    quality -= 0.08;
    output = canvas.toDataURL('image/jpeg', quality);
  }
  return { data: output, mimeType: 'image/jpeg' };
}
