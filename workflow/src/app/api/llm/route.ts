import { NextRequest, NextResponse } from 'next/server';
import { LLMGenerateRequest, LLMGenerateResponse } from '@/types';
import { logger } from '@/utils/logger';
import { generateText } from '@/lib/openrouter';


export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const requestId = `llm-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  try {
    const body: LLMGenerateRequest = await request.json();
    if (!body.prompt) return NextResponse.json<LLMGenerateResponse>({ success: false, error: 'Prompt is required' }, { status: 400 });
    const result = await generateText({
      model: String(body.model || 'google/gemini-3-flash-preview'),
      prompt: body.prompt,
      images: body.images || [],
      temperature: body.temperature ?? 0.7,
      maxTokens: body.maxTokens ?? 1024,
      timeoutMs: 60000,
    });
    return NextResponse.json<LLMGenerateResponse>({ success: true, text: result.text });
  } catch (error) {
    logger.error('api.error', 'OpenRouter LLM request failed', { requestId }, error instanceof Error ? error : undefined);
    return NextResponse.json<LLMGenerateResponse>({ success: false, error: error instanceof Error ? error.message : 'OpenRouter request failed' }, { status: 500 });
  }
}
