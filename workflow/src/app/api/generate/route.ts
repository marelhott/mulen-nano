import { NextRequest, NextResponse } from 'next/server';
import { GenerateRequest, GenerateResponse } from '@/types';
import { recordGenerateMetric } from '@/lib/observability/generateMetrics';
import { generateImage } from '@/lib/openrouter';


export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = `image-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const startedAt = Date.now();
  try {
    const body = await request.json() as GenerateRequest & { selectedModel?: { modelId?: string }; parameters?: Record<string, unknown>; dynamicInputs?: Record<string, string | string[]> };
    if (!body.prompt) return NextResponse.json<GenerateResponse>({ success: false, error: 'Prompt is required' }, { status: 400 });
    const selectedModel = body.selectedModel?.modelId;
    const model = selectedModel === 'nano-banana-pro'
      ? 'google/gemini-3-pro-image'
      : selectedModel === 'nano-banana'
        ? 'google/gemini-3.1-flash-image'
        : String(
            selectedModel ||
            (body.model === 'nano-banana-pro'
              ? 'google/gemini-3-pro-image'
              : 'google/gemini-3.1-flash-image')
          );
    const images = body.images || [];
    const result = await generateImage({
      model,
      prompt: body.prompt,
      images,
      aspectRatio: body.aspectRatio,
      resolution: body.resolution,
      timeoutMs: 300000,
    });
    recordGenerateMetric({ provider: 'openrouter', success: true, statusCode: 200, durationMs: Date.now() - startedAt });
    return NextResponse.json<GenerateResponse>({ success: true, image: result.imageBase64 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OpenRouter image generation failed';
    recordGenerateMetric({ provider: 'openrouter', success: false, statusCode: 500, durationMs: Date.now() - startedAt });
    return NextResponse.json<GenerateResponse>({ success: false, error: message }, { status: 500 });
  }
}
