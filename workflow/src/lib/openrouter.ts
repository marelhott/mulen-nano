const baseUrl = 'https://openrouter.ai/api/v1';

function headers() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY není nastavený.');
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER || 'https://mulen-nano.vercel.app', 'X-Title': process.env.OPENROUTER_X_TITLE || 'Mulen Nano Workflow' };
}

async function request(body: Record<string, unknown>, timeoutMs = 60000) {
  const response = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `OpenRouter HTTP ${response.status}`);
  return data;
}

export async function generateText(input: { model: string; prompt: string; images?: string[]; temperature?: number; maxTokens?: number; timeoutMs?: number }) {
  const content = [{ type: 'text', text: input.prompt }, ...(input.images || []).map((url) => ({ type: 'image_url', image_url: { url } }))];
  const data = await request({ model: input.model, messages: [{ role: 'user', content }], temperature: input.temperature, max_tokens: input.maxTokens }, input.timeoutMs);
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('OpenRouter model nevrátil text.');
  return { text: text.trim(), modelId: data?.model || input.model };
}

export async function generateImage(input: { model: string; prompt: string; images?: string[]; aspectRatio?: string; resolution?: string; timeoutMs?: number }) {
  const content = [{ type: 'text', text: input.prompt }, ...(input.images || []).map((url) => ({ type: 'image_url', image_url: { url } }))];
  const data = await request({ model: input.model, messages: [{ role: 'user', content }], modalities: ['image', 'text'], image_config: { aspect_ratio: input.aspectRatio, image_size: input.resolution } }, input.timeoutMs || 300000);
  const message = data?.choices?.[0]?.message || {};
  const image = [...(message.images || []), ...(data.images || [])].map((item: any) => item?.image_url?.url || item?.url || item?.data_url || (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : '')).find(Boolean);
  if (!image) throw new Error('OpenRouter model nevrátil obrázek.');
  return { imageBase64: image, modelId: data?.model || input.model };
}
