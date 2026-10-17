// Varianty: sourozenci jednoho obrazu obecným promptem na třech modelech.
// Čistá logika bez UI (prompt, modely, plán úloh), aby šla testovat samostatně.
// Prompt je doslova znění ověřené v ChatGPT (angličtina je záměr: modely na ni reagují nejlíp).

import { IMAGE_MODELS, type ImageModelChoice } from '../constants/imageModels';

export const VARIANTS_MAX_PER_MODEL = 5;

export type VariantsDistance = 'near' | 'middle' | 'far' | 'weird';

export const VARIANTS_DISTANCES: Array<{ id: VariantsDistance; label: string; hint: string }> = [
  { id: 'near', label: 'Blíž', hint: 'Skoro stejná póza, jen jiný úhel' },
  { id: 'middle', label: 'Střed', hint: 'Výchozí vzdálenost' },
  { id: 'far', label: 'Dál', hint: 'Silně jiná póza a kompozice' },
  { id: 'weird', label: 'Divně', hint: 'Podivný, snový, neobvyklý posun – stále stejná ruka' },
];

export const VARIANTS_GENERAL_PROMPT = `Create a new image from the same series as the attached image — a sibling, not a copy and not a different picture.

KEEP, exactly as in the original:
- the identity and character of the subject, including its oddities, ambiguity and imperfections; do not correct, idealise or make it more realistic or more normal
- the medium and technique (photograph, painting, print, drawing), the surface texture, grain and level of softness or sharpness
- the colour palette and tonal balance, the quality of light, the contrast
- the mood and emotional tone, the psychological presence
- the aspect ratio

CHANGE:
- the composition, camera angle or viewpoint, the pose or the direction of the gaze, the distance and the framing
- small details of the surroundings, so that it reads as another frame taken moments later or from another side

The result must feel unmistakably made by the same hand and in the same session, yet it must not repeat the original's composition.
Do not add text, captions, borders, watermarks or unrelated objects. Do not stylise, beautify or "fix" anything. Output one image.`;

const DISTANCE_SUFFIX: Record<VariantsDistance, string | null> = {
  near: 'Keep the change subtle: same pose family, slightly different angle.',
  middle: null,
  far: 'Change the pose and composition strongly while keeping everything listed under KEEP.',
  weird:
    'Make it genuinely weird: push the scene into the strange and uncanny — dream logic, unexpected scale, odd juxtapositions, distorted space, something quietly wrong or impossible — while the identity of the subject and everything listed under KEEP (medium, palette, light, mood) stays recognisably the same hand.',
};

/** Prázdný nebo bílý vlastní prompt = výchozí; vzdálenost přidá nanejvýš jednu větu. */
export function buildVariantsPrompt(base: string, distance: VariantsDistance): string {
  const trimmed = (base ?? '').trim();
  const text = trimmed.length > 0 ? trimmed : VARIANTS_GENERAL_PROMPT;
  const suffix = DISTANCE_SUFFIX[distance];
  return suffix ? `${text}\n\n${suffix}` : text;
}

export type VariantModelId = ImageModelChoice;

export type VariantModel = {
  id: VariantModelId;
  title: string;
  subtitle: string;
  /** OpenRouter model slug (ověřeno v katalogu OpenRouteru 2026-10-10). */
  model: string;
  /** FLUX 3 na OpenRouteru podporuje jen `seed`, takže mu rozlišení neposíláme. */
  resolution: string | undefined;
  note?: string;
};

export const VARIANT_MODELS: VariantModel[] = IMAGE_MODELS.map((item) => ({ ...item, subtitle: item.model }));

export function clampVariantCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(VARIANTS_MAX_PER_MODEL, Math.max(1, Math.round(value)));
}

export type VariantTask = { id: string; modelId: VariantModelId; variantIndex: number };

/** Úlohy v pořadí modelů z `VARIANT_MODELS` (ne podle pořadí výběru), duplicitní modely se slučují. */
export function planVariantTasks(
  selected: VariantModelId[],
  countPerModel: number,
  makeId: (modelId: VariantModelId, index: number) => string,
): VariantTask[] {
  const count = clampVariantCount(countPerModel);
  const chosen = new Set(selected);
  const tasks: VariantTask[] = [];
  for (const model of VARIANT_MODELS) {
    if (!chosen.has(model.id)) continue;
    for (let variantIndex = 0; variantIndex < count; variantIndex += 1) {
      tasks.push({ id: makeId(model.id, variantIndex), modelId: model.id, variantIndex });
    }
  }
  return tasks;
}

export function variantModelById(id: VariantModelId): VariantModel {
  return VARIANT_MODELS.find((model) => model.id === id) ?? VARIANT_MODELS[0];
}

/** Datum a čas běhu v historii, česky (např. „10. 10. 2026 14:05“). */
export function formatVariantsDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
