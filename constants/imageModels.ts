// Jeden katalog pro výběr, plánování úloh i kontrolu vstupů.
export const IMAGE_MODELS = [
  { id: 'nano-pro', title: 'Nano Pro', model: 'google/gemini-3-pro-image', minInputs: 0, maxInputs: 14, resolution: '1K' },
  { id: 'gemini', title: 'Nano Banana 2.1', model: 'google/gemini-nano-banana-2.1', minInputs: 0, maxInputs: 14, resolution: '1K' },
  { id: 'gpt', title: 'GPT Image 2.5', model: 'openai/gpt-image-2.5-sunburst', minInputs: 0, maxInputs: 16, resolution: undefined },
  { id: 'flux', title: 'FLUX 3', model: 'black-forest-labs/flux-3-image', minInputs: 0, maxInputs: 10, resolution: '1K' },
  { id: 'seedream', title: 'Seedream 5 Pro', model: 'bytedance-seed/seedream-5-0-pro', minInputs: 0, maxInputs: 14, resolution: '1K' },
  { id: 'muse', title: 'Muse', model: 'meta/muse-image', minInputs: 0, maxInputs: undefined, resolution: undefined },
  { id: 'grok', title: 'Grok Image 2', model: 'x-ai/grok-imagine-image-2.0', minInputs: 0, maxInputs: 3, resolution: '1K' },
  { id: 'mai', title: 'MAI Image 2.6', model: 'microsoft/mai-image-2.6', minInputs: 0, maxInputs: 5, resolution: undefined },
  { id: 'recraft', title: 'Recraft 4.1 Pro', model: 'recraft/recraft-v4.1-pro', minInputs: 0, maxInputs: 1, resolution: undefined },
  { id: 'qwen-uncensored', title: 'Qwen Uncensored', model: 'venice/qwen-edit-uncensored', minInputs: 1, maxInputs: 3, resolution: undefined },
  { id: 'qwen-turbo', title: 'Qwen Turbo', model: 'venice/qwen-image-2-1-turbo-edit', minInputs: 1, maxInputs: 6, resolution: '1K' },
  { id: 'qwen-pro', title: 'Qwen Pro', model: 'venice/qwen-image-2-1-pro-edit', minInputs: 1, maxInputs: 10, resolution: '1K' },
  { id: 'lustify', title: 'Lustify v8', model: 'venice/lustify-v8', minInputs: 0, maxInputs: 0, resolution: undefined },
] as const;

export type ImageModelId = (typeof IMAGE_MODELS)[number]['model'];
export type ImageModelChoice = (typeof IMAGE_MODELS)[number]['id'];
export function imageModelById(model: string) {
  return IMAGE_MODELS.find((item) => item.model === model);
}
export function imageModelInputError(model: string, count: number): string | undefined {
  const item = imageModelById(model);
  if (!item) return 'Neznámý obrazový model.';
  if (count < item.minInputs) return `${item.title} vyžaduje vstupní obrázek.`;
  if (item.maxInputs === 0 && count > 0) return `${item.title} podporuje pouze generování z textu, ne úpravy fotografií.`;
  if (item.maxInputs !== undefined && count > item.maxInputs) return `${item.title} přijímá nejvýše ${item.maxInputs} vstupních obrázků. Není použit jiný model ani vynechána reference.`;
}
