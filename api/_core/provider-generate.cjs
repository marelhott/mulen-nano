const { generateText, generateImage, DEFAULT_TEXT_MODEL, DEFAULT_VISION_MODEL, DEFAULT_IMAGE_MODEL } = require('../../lib/openrouter.cjs');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

const cleanJson = (value) => String(value || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
const modelFor = (requested, fallback) => String(requested || '').trim() || fallback;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { success: false, error: 'Method not allowed' });
  try {
    const body = JSON.parse(event.body || '{}');
    const action = String(body.action || '');
    const apiKey = String(body.apiKey || '').trim() || undefined;
    let result;

    if (action === 'generateImage') {
      result = await generateImage({
        model: modelFor(body.preferredModel, DEFAULT_IMAGE_MODEL),
        prompt: String(body.prompt || ''),
        images: Array.isArray(body.images) ? body.images.map((image) => image?.data).filter(Boolean) : [],
        aspectRatio: body.aspectRatio,
        resolution: body.resolution,
        apiKey,
      });
    } else if (action === 'enhancePrompt') {
      const response = await generateText({
        model: modelFor(body.textModel, DEFAULT_TEXT_MODEL),
        prompt: `Jsi profesionální prompt engineer. Rozšiř následující prompt pro generování obrázku. Vrať pouze výsledný prompt v češtině.\n\n${body.shortPrompt || body.prompt || ''}`,
        maxTokens: 1024,
        apiKey,
      });
      result = response.text || body.shortPrompt || body.prompt || '';
    } else if (action === 'generate3PromptVariants') {
      const response = await generateText({
        model: modelFor(body.textModel, DEFAULT_TEXT_MODEL),
        prompt: `Vytvoř přesně tři malé, ale znatelné varianty promptu pro AI generování obrázků. Vrať pouze JSON pole: [{"variant":"...","approach":"...","prompt":"..."}].\n\nPrompt: ${body.prompt || ''}`,
        temperature: 0.7,
        maxTokens: 4096,
        apiKey,
      });
      const parsed = JSON.parse(cleanJson(response.text));
      result = Array.isArray(parsed) ? parsed : parsed.variants;
      if (!Array.isArray(result) || result.length !== 3) throw new Error('Model nevrátil tři platné varianty promptu.');
    } else if (action === 'analyzeImageForJson') {
      const response = await generateText({
        model: modelFor(body.visionModel, DEFAULT_VISION_MODEL),
        images: [body.imageDataUrl].filter(Boolean),
        prompt: 'Analyze this image and return ONLY valid JSON describing subject, environment, lighting, camera, aesthetic, and technical quality.',
        maxTokens: 2048,
        apiKey,
      });
      result = cleanJson(response.text);
    } else if (action === 'analyzeStyleTransfer') {
      const response = await generateText({
        model: modelFor(body.visionModel, DEFAULT_VISION_MODEL),
        images: [body.referenceDataUrl, body.styleDataUrl].filter(Boolean),
        prompt: 'Compare image A (content) and image B (style). Return ONLY JSON: {"recommendedStrength": number 0-100, "styleDescription": string, "negativePrompt": string}.',
        maxTokens: 2048,
        apiKey,
      });
      result = JSON.parse(cleanJson(response.text));
    } else {
      throw new Error(`Unsupported OpenRouter action: ${action}`);
    }
    return json(200, { success: true, result });
  } catch (error) {
    return json(500, { success: false, error: error?.message || 'OpenRouter request failed' });
  }
};
