const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_TEXT_MODEL = 'google/gemini-3-flash-preview';
const DEFAULT_VISION_MODEL = 'google/gemini-3-flash-preview';
const DEFAULT_IMAGE_MODEL = 'google/gemini-3.1-flash-image-preview';

function getOpenRouterKey() {
  return String(process.env.OPENROUTER_API_KEY || '').trim();
}

function getHeaders(apiKey = getOpenRouterKey()) {
  if (!apiKey) throw new Error('OPENROUTER_API_KEY není nastavený na serveru.');
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': String(process.env.OPENROUTER_HTTP_REFERER || 'https://mulen-nano.vercel.app'),
    'X-Title': String(process.env.OPENROUTER_X_TITLE || 'Mulen Nano'),
  };
}

async function request(path, body, { timeoutMs = 120000, apiKey } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}${path}`, {
      method: 'POST',
      headers: getHeaders(apiKey),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || data?.message || `OpenRouter HTTP ${response.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function dataUrlToContentPart(dataUrl) {
  return { type: 'image_url', image_url: { url: String(dataUrl || '') } };
}

function textFromResponse(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map((part) => part?.text || '').join('').trim();
  return '';
}

function imageFromResponse(data) {
  const message = data?.choices?.[0]?.message || {};
  const candidates = [...(Array.isArray(message.images) ? message.images : []), ...(Array.isArray(data?.images) ? data.images : []), ...(Array.isArray(message.content) ? message.content : [])];
  for (const item of candidates) {
    const url = item?.image_url?.url || item?.url || item?.data_url || item?.b64_json;
    if (!url) continue;
    if (String(url).startsWith('data:')) return String(url);
    if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
    return String(url);
  }
  return null;
}

async function chat({ model = DEFAULT_TEXT_MODEL, messages, temperature, maxTokens, responseFormat, timeoutMs, apiKey }) {
  const body = { model, messages };
  if (typeof temperature === 'number') body.temperature = temperature;
  if (typeof maxTokens === 'number') body.max_tokens = maxTokens;
  if (responseFormat) body.response_format = responseFormat;
  return request('/chat/completions', body, { timeoutMs, apiKey });
}

async function generateText({ prompt, images = [], model = DEFAULT_TEXT_MODEL, temperature = 0.4, maxTokens = 2048, responseFormat, timeoutMs, apiKey }) {
  const content = [{ type: 'text', text: prompt }, ...images.map(dataUrlToContentPart)];
  const data = await chat({ model, messages: [{ role: 'user', content }], temperature, maxTokens, responseFormat, timeoutMs, apiKey });
  const text = textFromResponse(data);
  if (!text) throw new Error('OpenRouter model nevrátil textový výstup.');
  return { text, modelId: data?.model || model };
}

async function generateImage({ prompt, images = [], model = DEFAULT_IMAGE_MODEL, aspectRatio, resolution, timeoutMs, apiKey }) {
  const content = [{ type: 'text', text: prompt }, ...images.map(dataUrlToContentPart)];
  const body = { model, messages: [{ role: 'user', content }], modalities: ['image', 'text'] };
  if (aspectRatio && aspectRatio !== 'Original') body.image_config = { aspect_ratio: aspectRatio };
  if (resolution) body.image_config = { ...(body.image_config || {}), image_size: resolution };
  const data = await request('/chat/completions', body, { timeoutMs: timeoutMs || 300000, apiKey });
  const image = imageFromResponse(data);
  if (!image) {
    const text = textFromResponse(data);
    throw new Error(text ? `Model nevrátil obrázek: ${text.slice(0, 300)}` : 'OpenRouter model nevrátil obrázek.');
  }
  return { imageBase64: image, modelId: data?.model || model };
}

async function validateKey(apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}/models`, { headers: getHeaders(apiKey), signal: controller.signal });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error?.message || `OpenRouter HTTP ${response.status}`);
    }
    return true;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { DEFAULT_TEXT_MODEL, DEFAULT_VISION_MODEL, DEFAULT_IMAGE_MODEL, getOpenRouterKey, generateText, generateImage, validateKey, textFromResponse, imageFromResponse };
