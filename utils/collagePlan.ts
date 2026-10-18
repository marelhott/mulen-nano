// Koláž (v UI i „fúze“): symbiotické umělecké spojení dvou a více obrázků do jednoho díla jedním obecným
// promptem na všech modelech. Záměrně NE doslovná koláž z vystřižených kousků.
// Čistá logika bez UI. Modely a plán úloh sdílí se sekcí Varianty.

import { VARIANTS_MAX_PER_MODEL } from './variantsPlan';

export const COLLAGE_MIN_SOURCES = 1;
export const COLLAGE_MAX_SOURCES = 10;
export const COLLAGE_MAX_PER_MODEL = VARIANTS_MAX_PER_MODEL;

/** Rezerva pro base64 a JSON pod limitem těla požadavku Vercelu. */
const COLLAGE_TOTAL_INPUT_BYTES = 2_800_000;

export function collageInputBudget(sourceCount: number): { targetBytes: number; maxDimension: number } {
  const n = Math.max(1, sourceCount);
  return { targetBytes: Math.floor(COLLAGE_TOTAL_INPUT_BYTES / n), maxDimension: 1400 };
}

export const COLLAGE_GENERAL_PROMPT = `Combine the attached images into ONE new, unified artwork: a symbiosis of the ideas in them, not a collage. Interpret them in an artistic, partly abstract way.

IT MUST NOT LOOK LIKE A COLLAGE:
- no cut-outs, pasted fragments, torn paper, visible seams, borders or frames
- do not place the images side by side, do not stack or overlap them as separate pieces
- do not simply paste the subject of one image onto the background of the other

IT MUST FEEL LIKE ONE WORK:
- one coherent scene with one logic of light, space, surface and medium (for example a single painting or a single photograph)
- the images grow into one another: the figure, forms or motifs of one live inside the space, light and atmosphere of the other; shapes may dissolve, merge, echo or transform into each other
- where the two meet, let it become painterly, abstract or ambiguous
- keep the recognisable essence of each source (its key subject, mood and colours), so that both ideas are still felt

LESS IS MORE: restrained, few elements, a calm composition with room to breathe, no clutter, no decoration, no filler.

Do not add text, captions, borders, watermarks or logos. Output one image.`;

/** Prázdný nebo bílý vlastní prompt = výchozí znění. */
export function buildCollagePrompt(base: string): string {
  const trimmed = (base ?? '').trim();
  return trimmed.length > 0 ? trimmed : COLLAGE_GENERAL_PROMPT;
}

export function buildSingleSourceCollagePrompt(base: string): string {
  return base.trim() || 'Create one new artistic collage using only the attached image as its source. Recompose its shapes, colours, textures and visual motifs into a coherent new artwork. Do not add text, captions, watermarks or unrelated subjects. Output one image.';
}

/**
 * Qwen Edit upravuje první obrázek a ostatní bere jako vrstvy, proto dostane instrukci ve tvaru
 * „uprav obrázek 1 tak, aby splynul s obrázkem 2“. Obecný popis „koláž z obrázků“ nechápe jako úpravu.
 */
export function buildCollageEditInstruction(imageCount: number): string {
  const others = imageCount <= 2 ? 'image 2' : `images ${Array.from({ length: imageCount - 1 }, (_, i) => i + 2).join(' and ')}`;
  return `Edit image 1 so that it merges with ${others}: let the main figures, shapes and motifs of ${imageCount <= 2 ? 'image 2' : 'the other images'} grow into the scene, light and atmosphere of image 1, so that they become one single, partly abstract, painterly picture. No cut-outs, no borders, no side-by-side placement. Keep it restrained: few elements, a calm composition, one logic of light.`;
}

/** Posune pořadí vstupů, aby byl základem u každé varianty jiný obrázek (Qwen bere první jako základ). */
export function rotateInputs<T>(items: T[], index: number): T[] {
  if (items.length === 0) return items;
  const shift = ((index % items.length) + items.length) % items.length;
  return [...items.slice(shift), ...items.slice(0, shift)];
}
