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

/** Pevná pravidla, která se připojí k instrukci od vizuálního modelu, aby je obrazový model nepřepsal po svém. */
export const COLLAGE_FIDELITY_TAIL = 'Keep the medium, grain, colour and light of the sources. Add nothing that is not in them. Keep every subject whole and recognisable, no hybrids, no repainting, no hard seams, no borders or text. Output one image.';

const ASPECTS: Array<[string, number]> = [['9:16', 9 / 16], ['2:3', 2 / 3], ['3:4', 3 / 4], ['4:5', 4 / 5], ['1:1', 1], ['5:4', 5 / 4], ['4:3', 4 / 3], ['3:2', 3 / 2], ['16:9', 16 / 9]];

/** Nejbližší podporovaný poměr stran k rozměrům podkladové fotky. */
export function nearestAspectRatio(width: number, height: number): string {
  if (!(width > 0) || !(height > 0)) return 'Original';
  const ratio = width / height;
  return ASPECTS.reduce((best, item) => (Math.abs(Math.log(item[1] / ratio)) < Math.abs(Math.log(best[1] / ratio)) ? item : best))[0];
}

export const COLLAGE_GENERAL_PROMPT = `Fuse the attached images into ONE organic picture. One image is the carrier (about 70% of the frame); the other flows into it gently, in one place only, so that the two read as a single moment. Everything comes from the sources.

FIDELITY RULES (most important):
- keep the medium of the sources: if they are photographs the result is a photograph with the same grain, colour and light; never repaint it as an illustration, oil painting or fantasy art
- add NOTHING that is not in the sources: no new objects, creatures, plants, water, buildings, effects, sparkles or decoration
- keep every subject whole, recognisable and unchanged in identity (faces, shapes, colours, textures stay as in the source); no hybrids, no creatures made of two things
- do not restyle, recolour, smooth or "improve" anything

HOW THEY MERGE:
- through what they already share: a matching tone, a line that continues from one image into the other, a similar shape, the same direction of light
- a soft, semi-transparent blend (like a careful double exposure) or a gradual dissolve exactly where the shared tone or line is, not a hard edge
- one consistent light and perspective across the whole picture
- the rest of the picture stays calm and untouched; less is more

NEVER: patchwork, tiles, cut-outs, collage-style pasted pieces, hard seams, split screens, side-by-side placement, borders, frames, text, watermarks. Output one image.`;

/** Prázdný nebo bílý vlastní prompt = výchozí znění. */
export function buildCollagePrompt(base: string): string {
  const trimmed = (base ?? '').trim();
  return trimmed.length > 0 ? trimmed : COLLAGE_GENERAL_PROMPT;
}

export const SINGLE_SOURCE_COLLAGE_PROMPT = `Rework the attached image as a restrained, organic fusion of its own two strongest ideas (for example its subject and its surroundings). Everything comes from the image itself.

FIDELITY RULES (most important):
- keep the medium of the sources: if they are photographs the result is a photograph with the same grain, colour and light; never repaint it as an illustration, oil painting or fantasy art
- add NOTHING that is not in the sources: no new objects, creatures, plants, water, buildings, effects, sparkles or decoration
- keep every subject whole, recognisable and unchanged in identity (faces, shapes, colours, textures stay as in the source); no hybrids, no creatures made of two things
- do not restyle, recolour, smooth or "improve" anything

HOW THEY MERGE: through what they already share (a tone, a line, a shape, the direction of light), by a soft semi-transparent blend or a gradual dissolve in one place only; one light, one perspective; the rest stays calm. Less is more.

NEVER: patchwork, tiles, cut-outs, hard seams, repeating the source, borders, text, watermarks. Output one image.`;

/** Každý výsledek dostane jinou výtvarnou techniku, aby se varianty skutečně lišily a nebyly obecné. */
export const COLLAGE_TECHNIQUES = [
  'Technique: careful double exposure. One image shows through the other with soft, partial transparency, aligned on a shared shape or line.',
  'Technique: continuing line. A contour or line from one image carries on into the other, and the picture changes character along that line.',
  'Technique: tonal dissolve. The two images dissolve into each other across a band of shared tone, with no visible seam.',
  'Technique: shared light. The second image enters through the area where both have the same light, and nowhere else.',
  'Technique: quiet inset. A small, precisely placed part of the second image blends into the first at a point where their shapes rhyme.',
];

export function pickCollageTechnique(seed: number): string {
  return COLLAGE_TECHNIQUES[((Math.floor(seed) % COLLAGE_TECHNIQUES.length) + COLLAGE_TECHNIQUES.length) % COLLAGE_TECHNIQUES.length];
}

/** Vlastní prompt uživatele se nikdy neupravuje; výchozí dostane navíc náhodně zvolenou techniku. */
export function buildSingleSourceCollagePrompt(base: string, technique?: string): string {
  const trimmed = (base ?? '').trim();
  if (trimmed) return trimmed;
  return technique ? `${SINGLE_SOURCE_COLLAGE_PROMPT}\n\n${technique}` : SINGLE_SOURCE_COLLAGE_PROMPT;
}

/**
 * Qwen Edit upravuje první obrázek a ostatní bere jako vrstvy, proto dostane instrukci ve tvaru
 * „uprav obrázek 1 tak, aby splynul s obrázkem 2“. Obecný popis „koláž z obrázků“ nechápe jako úpravu.
 */
export function buildCollageEditInstruction(imageCount: number): string {
  const others = imageCount <= 2 ? 'image 2' : `images ${Array.from({ length: imageCount - 1 }, (_, i) => i + 2).join(' and ')}`;
  return `Edit image 1 so that ${others} blend${imageCount <= 2 ? 's' : ''} gently into it in one place only: keep image 1 as the carrier (about 70% of the frame), keep the medium, grain, colour and light of the sources, add nothing that is not in them, keep every subject whole and recognisable, and merge them through a shared tone, line or shape with a soft semi-transparent blend or dissolve. No cut-outs, no hard seams, no new objects, no repainting. Less is more.`;
}

/** Posune pořadí vstupů, aby byl základem u každé varianty jiný obrázek (Qwen bere první jako základ). */
export function rotateInputs<T>(items: T[], index: number): T[] {
  if (items.length === 0) return items;
  const shift = ((index % items.length) + items.length) % items.length;
  return [...items.slice(shift), ...items.slice(0, shift)];
}
