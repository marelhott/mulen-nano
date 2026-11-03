const { generateText, generateImage, DEFAULT_TEXT_MODEL, DEFAULT_VISION_MODEL, DEFAULT_IMAGE_MODEL } = require('../../lib/openrouter.cjs');
const { isExternalModel, generateExternalImage } = require('../../lib/external-images.cjs');
const { json, denyUnauthorized } = require('../../lib/apiAuth.cjs');

const cleanJson = (value) => String(value || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
const modelFor = (requested, fallback) => String(requested || '').trim() || fallback;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { success: false, error: 'Method not allowed' });
  try {
    const body = JSON.parse(event.body || '{}');
    const action = String(body.action || '');
    const apiKey = String(body.apiKey || '').trim() || undefined;

    // Ověření chrání jen volání, která by utratila serverový klíč. Kdo si přinese vlastní
    // klíč, platí si volání sám a PIN nepotřebuje.
    const usesServerKey = action === 'generateImage' && isExternalModel(body.preferredModel)
      ? !String(body.externalApiKey || '').trim()
      : !apiKey;
    if (usesServerKey) {
      const unauthorized = denyUnauthorized(event);
      if (unauthorized) return unauthorized;
    }

    let result;

    if (action === 'generateImage') {
      result = isExternalModel(body.preferredModel) ? await generateExternalImage(body) : await generateImage({
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
    } else if (action === 'composeCollageConcept') {
      const images = Array.isArray(body.images) ? body.images.map((image) => image?.data || image).filter(Boolean) : [];
      const response = await generateText({
        model: modelFor(body.visionModel, DEFAULT_VISION_MODEL),
        images,
        prompt: [
          `You are a restrained photo editor. Look at the ${images.length} attached images and write ONE precise instruction for fusing them into a single organic picture.`,
          'Decide: (1) which image is the carrier (about 70% of the frame, its medium, grain, colour and light are kept as they are); (2) the single place where the other image(s) enter; (3) what they merge through: a shared tone, a line that continues from one into the other, a similar shape or the direction of light; (4) the kind of blend: a soft semi-transparent overlay or a gradual dissolve at exactly that place.',
          'Hard rules: add NOTHING that is not visible in the attached images (no new objects, creatures, plants, water, buildings, effects); keep the medium (a photograph stays a photograph, never repainted as illustration or oil painting); keep every subject whole and recognisable, no hybrids; one light, one perspective; the rest of the picture stays calm and untouched. Less is more.',
          'Output ONLY the instruction, in English, 70-120 words, concrete about WHAT is placed WHERE and THROUGH WHAT they merge. No poetry, no metaphors, no mention of "image 1/2" (describe the subjects themselves), no mention of style or art movements.',
        ].join('\n\n'),
        temperature: 0.4,
        maxTokens: 500,
        apiKey,
      });
      result = String(response.text || '').trim();
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
    return json(error?.upstreamStatus || 500, { success: false, error: error?.message || 'OpenRouter request failed', provider: error?.provider, isByok: error?.isByok, quota: error?.quota });
  }
};
