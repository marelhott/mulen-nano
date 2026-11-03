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

export const COLLAGE_GENERAL_PROMPT = `Fuse the attached images into ONE seamless artwork in which their worlds melt into each other: a metamorphosis, not an assembly. Take the strongest idea of each image (its subject, motif, material, era or mood) and let them flow into one another through a fluid, continuous transformation.

HOW THE FUSION WORKS:
- there is no edge where one idea ends and the other begins: the contour of one becomes the contour of the other, a shape slowly turns into something else across the picture (hair into rivers, folds of fabric into mountain ridges, architecture into bone, smoke into figures)
- use double exposure, gradient dissolves, shared silhouettes, forms that are two things at once, scale play (a landscape living inside a figure, a figure built from a landscape)
- one light, one atmosphere, one medium, one depth of space, so the result reads as a single painting or photograph that simply holds two ideas
- be bold and surprising: a poetic visual metaphor a viewer stops and wonders at, never the obvious "A next to B"
- keep the recognisable essence and colours of every source, so each idea is still felt

SOPHISTICATED, NOT BUSY: refined palette drawn from the sources, controlled composition, deliberate negative space, fine detail concentrated where the ideas meet, gallery-quality finish.

NEVER: patchwork, tiles, grids, mosaics, cut-outs, torn paper, hard edges between parts, split screens, side-by-side placement, borders or frames, text, captions, watermarks or logos. Output one image.`;

/** Prázdný nebo bílý vlastní prompt = výchozí znění. */
export function buildCollagePrompt(base: string): string {
  const trimmed = (base ?? '').trim();
  return trimmed.length > 0 ? trimmed : COLLAGE_GENERAL_PROMPT;
}

export const SINGLE_SOURCE_COLLAGE_PROMPT = `Reimagine the attached image as ONE seamless fusion artwork in which two worlds melt into each other. Find the two strongest ideas inside the image (for example its subject and the world around it, or two contrasting motifs, materials, eras or moods) and let them flow into one another through a fluid, continuous transformation: a metamorphosis, not an assembly.

HOW THE FUSION WORKS:
- there is no edge where one idea ends and the other begins: the contour of one becomes the contour of the other, a shape slowly turns into something else across the picture (hair into rivers, folds of fabric into mountain ridges, architecture into bone, smoke into figures)
- use double exposure, gradient dissolves, shared silhouettes, forms that are two things at once, scale play (a landscape living inside a figure, a figure built from a landscape)
- one light, one atmosphere, one medium, one depth of space, so the result reads as a single painting or photograph that simply holds two ideas
- be bold and surprising: a poetic visual metaphor a viewer stops and wonders at, not a filter, recolour or slight rearrangement of the source
- keep the recognisable essence and the colour world of the source

SOPHISTICATED, NOT BUSY: refined palette drawn from the source, controlled composition, deliberate negative space, fine detail concentrated where the two ideas meet, gallery-quality finish.

NEVER: patchwork, tiles, grids, mosaics, cut-outs, torn paper, hard edges between parts, split screens, repeating or duplicating the source, borders or frames, text, captions, watermarks or logos. Output one image.`;

/** Každý výsledek dostane jinou výtvarnou techniku, aby se varianty skutečně lišily a nebyly obecné. */
export const COLLAGE_TECHNIQUES = [
  'Technique: double exposure. A strong silhouette of one idea is filled from edge to edge with the other idea, with soft gradient transitions inside it.',
  'Technique: metamorphosis. Across the picture one form gradually transforms into another, so the viewer cannot say where the change happens.',
  'Technique: world within a form. A landscape, city or ocean lives inside the main shape, lit by one light that belongs to both.',
  'Technique: liquid melt. Forms flow and drip into each other like wet paint or water, colours bleeding smoothly across the boundary.',
  'Technique: shared contour. One line draws two things at once, so the outline of the first becomes the horizon, ridge or fold of the second.',
  'Technique: surreal scale shift. Tiny elements of one idea inhabit the vast landscape of the other, in one believable space with one perspective.',
  'Technique: dissolving into light and mist. One idea fades into the other through atmosphere, haze and luminous gradients, with no visible seam.',
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
  return `Edit image 1 so that it melts into ${others}: let the main figures, shapes and motifs of ${imageCount <= 2 ? 'image 2' : 'the other images'} flow into the scene, light and atmosphere of image 1 through a fluid, seamless transformation, so that they become one single picture where the contour of one idea turns into the contour of another (double exposure, shared silhouettes, gradual metamorphosis). No cut-outs, no tiles, no hard edges, no borders, no side-by-side placement. Sophisticated and bold, one logic of light.`;
}

/** Posune pořadí vstupů, aby byl základem u každé varianty jiný obrázek (Qwen bere první jako základ). */
export function rotateInputs<T>(items: T[], index: number): T[] {
  if (items.length === 0) return items;
  const shift = ((index % items.length) + items.length) % items.length;
  return [...items.slice(shift), ...items.slice(0, shift)];
}
