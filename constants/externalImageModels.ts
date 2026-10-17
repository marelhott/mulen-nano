export const QWEN_EDIT_MODELS = [
  { model: 'venice/qwen-edit-uncensored', title: 'Uncensored', maxImages: 3 },
  { model: 'venice/qwen-image-2-1-turbo-edit', title: 'Turbo', maxImages: 6 },
  { model: 'venice/qwen-image-2-1-pro-edit', title: 'Pro', maxImages: 10 },
] as const;

export type ExternalImageModel =
  | (typeof QWEN_EDIT_MODELS)[number]['model']
  | 'runware/sdxl'
  | 'venice/lustify-v8';
export function isExternalImageModel(model = ''): model is ExternalImageModel {
  return (
    QWEN_EDIT_MODELS.some((item) => item.model === model) ||
    model === 'runware/sdxl' ||
    model === 'venice/lustify-v8'
  );
}
export function externalModelLabel(model: string): string | undefined {
  const qwen = QWEN_EDIT_MODELS.find((item) => item.model === model);
  if (qwen) return `Qwen ${qwen.title}`;
  if (model === 'runware/sdxl') return 'Runware SDXL';
  if (model === 'venice/lustify-v8') return 'Lustify v8';
}
