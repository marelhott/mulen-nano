import { COLLAGE_MAX_SOURCES, collageInputBudget } from './collagePlan';
import { optimizeVariantsInput } from './variantsInput';

export type ReferenceImage = { name: string; dataUrl: string; mimeType: string };

export async function prepareIndependentImages(sources: ReferenceImage[]) {
  if (sources.length < 1 || sources.length > COLLAGE_MAX_SOURCES) {
    throw new Error(`Vlož 1 až ${COLLAGE_MAX_SOURCES} vstupních obrázků.`);
  }
  return Promise.all(sources.map(async (source) => (await prepareReferenceImages([source]))[0]));
}

export async function prepareReferenceImages(sources: ReferenceImage[]) {
  if (sources.length < 1 || sources.length > COLLAGE_MAX_SOURCES) {
    throw new Error(`Vlož 1 až ${COLLAGE_MAX_SOURCES} vstupních obrázků.`);
  }
  const budget = collageInputBudget(sources.length);
  const inputs = await Promise.all(sources.map((item) => optimizeVariantsInput(item.dataUrl, item.mimeType, budget)));
  if (inputs.reduce((sum, item) => sum + item.data.length, 0) > 4_000_000) {
    throw new Error('Vstupní obrázky jsou příliš velké i po zmenšení. Použij menší soubory.');
  }
  return inputs;
}
