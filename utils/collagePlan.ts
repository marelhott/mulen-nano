// Koláž: volná, umělecká koláž ze dvou a více obrázků jedním obecným promptem na všech modelech.
// Čistá logika bez UI. Modely a plán úloh sdílí se sekcí Varianty.

import { VARIANTS_MAX_PER_MODEL } from './variantsPlan';

export const COLLAGE_MIN_SOURCES = 2;
export const COLLAGE_MAX_SOURCES = 6;
export const COLLAGE_MAX_PER_MODEL = VARIANTS_MAX_PER_MODEL;

/** Tělo požadavku na serveru je omezené na 6 MB, proto se celkový rozpočet dělí mezi vstupy. */
const COLLAGE_TOTAL_INPUT_BYTES = 4_200_000;

export function collageInputBudget(sourceCount: number): { targetBytes: number; maxDimension: number } {
  const n = Math.max(1, sourceCount);
  return { targetBytes: Math.floor(COLLAGE_TOTAL_INPUT_BYTES / n), maxDimension: 1400 };
}

export const COLLAGE_GENERAL_PROMPT = `Make one collage from the attached images. Work freely and artistically: treat the sources as raw material, not as something to preserve or reproduce.

Cut, tear, layer, overlap, rotate, scale and recombine fragments of the images into a single new composition. Use fragments from at least two of the attached images, and let the meeting of them create an unexpected meaning or tension.

LESS IS MORE:
- few, strong elements instead of many; do not use every part of every image
- generous empty space, a clear focal point and a confident, even asymmetric balance
- restraint in colour: a limited palette drawn from the sources
- visible cut edges, paper, halftone or grain are welcome; clutter, decoration and filler are not

Do not add text, captions, borders, frames, watermarks or logos. Output one image.`;

/** Prázdný nebo bílý vlastní prompt = výchozí znění. */
export function buildCollagePrompt(base: string): string {
  const trimmed = (base ?? '').trim();
  return trimmed.length > 0 ? trimmed : COLLAGE_GENERAL_PROMPT;
}
