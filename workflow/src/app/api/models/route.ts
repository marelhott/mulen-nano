import { NextRequest, NextResponse } from 'next/server';

const models = [
  { id: 'google/gemini-3.1-flash-image-preview', name: 'Nano 2', description: 'Rychlá tvorba a úpravy obrázků přes OpenRouter.', provider: 'openrouter', capabilities: ['text-to-image', 'image-to-image'] },
  { id: 'google/gemini-3-pro-image-preview', name: 'Nano Pro', description: 'Kvalitní tvorba a úpravy obrázků přes OpenRouter.', provider: 'openrouter', capabilities: ['text-to-image', 'image-to-image'] },
  { id: 'openai/gpt-image-1', name: 'GPT Image', description: 'Obrázkový model dostupný přes OpenRouter.', provider: 'openrouter', capabilities: ['text-to-image', 'image-to-image'] },
  { id: 'black-forest-labs/flux.2-pro', name: 'FLUX Pro', description: 'Obrázkový model dostupný přes OpenRouter.', provider: 'openrouter', capabilities: ['text-to-image', 'image-to-image'] },
];

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams.get('search')?.toLowerCase();
  return NextResponse.json({ models: search ? models.filter((model) => `${model.id} ${model.name}`.toLowerCase().includes(search)) : models, providers: ['openrouter'] });
}
