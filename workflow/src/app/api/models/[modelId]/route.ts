import { NextRequest, NextResponse } from 'next/server';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ modelId: string }> }) {
  const { modelId } = await params;
  return NextResponse.json({ id: decodeURIComponent(modelId), provider: 'openrouter', inputs: ['prompt', 'image'], parameters: [] });
}
