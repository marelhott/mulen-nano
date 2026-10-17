const { randomUUID } = require('node:crypto');

const QWEN = {
  'venice/qwen-edit-uncensored': {
    id: 'qwen-edit-uncensored',
    max: 3,
    promptMax: 1500,
  },
  'venice/qwen-image-2-1-turbo-edit': {
    id: 'qwen-image-2-1-turbo-edit',
    max: 6,
    promptMax: 10000,
  },
  'venice/qwen-image-2-1-pro-edit': {
    id: 'qwen-image-2-1-pro-edit',
    max: 10,
    promptMax: 10000,
  },
};
const isExternalModel = (model) =>
  Object.hasOwn(QWEN, model) ||
  model === 'venice/lustify-v8' ||
  model === 'runware/sdxl';

// Klíč vložený do Vercelu s uvozovkami nebo s koncem řádku by jinak poskytovatel odmítl jako neplatný.
function cleanKey(value) {
  let key = String(value ?? '').trim();
  // Dvě průchody: uvozovky i konec řádku se mohou vyskytnout v obou pořadích.
  for (let pass = 0; pass < 2; pass += 1) {
    key = key.replace(/\\n$/, '').trim();
    if (/^(["']).*\1$/.test(key)) key = key.slice(1, -1).trim();
  }
  return key;
}

function providerKey(provider, override) {
  const name = provider === 'venice' ? 'VENICE_API_KEY' : 'RUNWARE_API_KEY';
  const key = cleanKey(override || process.env[name]);
  if (!key)
    throw new Error(
      `Chybí ${name}. Zadej klíč v nastavení nebo jej nastav na serveru.`
    );
  return key;
}

async function request(url, apiKey, body, binary = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 270000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      // Citlivé odpovědi upstreamu (mohou obsahovat vstupní data) neposíláme klientovi.
      const hints = {
        401: `Neplatný API klíč (má ${apiKey.length} znaků).`,
        402: 'Nedostatek kreditu.',
        429: 'Překročen limit požadavků.',
      };
      // Zpráva poskytovatele pomáhá s diagnostikou (např. špatný parametr); data URL se vyřadí a text zkrátí.
      let detail = '';
      try {
        const parsed = JSON.parse(await response.text());
        detail = String(
          parsed?.error?.message ||
            (typeof parsed?.error === 'string' ? parsed.error : '') ||
            parsed?.errors?.[0]?.message ||
            parsed?.message ||
            ''
        )
          .replace(/data:[^\s"']+/g, '[data]')
          .slice(0, 200);
      } catch {
        // tělo odpovědi není JSON
      }
      throw new Error(
        `${url.includes('venice') ? 'Venice' : 'Runware'} HTTP ${response.status}. ${hints[response.status] || 'Požadavek poskytovatel odmítl.'}${detail ? ` (${detail})` : ''}`
      );
    }
    if (binary) {
      const mime = (response.headers.get('content-type') || '').split(';')[0];
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime))
        throw new Error('Venice nevrátil obrázek.');
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) throw new Error('Venice vrátil prázdný obrázek.');
      return `data:${mime};base64,${buffer.toString('base64')}`;
    }
    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError')
      throw new Error('Časový limit generování byl překročen.', {
        cause: error,
      });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function dimensions(body) {
  let ratio = Number(body.width) / Number(body.height);
  if (body.aspectRatio && body.aspectRatio !== 'Original') {
    const match = /^(\d+):(\d+)$/.exec(body.aspectRatio);
    if (!match) throw new Error('Neplatný poměr stran.');
    ratio = Number(match[1]) / Number(match[2]);
  }
  if (!Number.isFinite(ratio) || ratio <= 0) ratio = 1;
  ratio = Math.min(4, Math.max(0.25, ratio));
  return {
    width: Math.round((ratio >= 1 ? 1024 : 1024 * ratio) / 8) * 8,
    height: Math.round((ratio <= 1 ? 1024 : 1024 / ratio) / 8) * 8,
  };
}

async function generateExternalImage(body) {
  const model = body.preferredModel;
  if (!isExternalModel(model)) throw new Error('Nepodporovaný externí model.');
  const images = Array.isArray(body.images)
    ? body.images.map((image) => image?.data)
    : [];
  if (
    images.some(
      (image) =>
        typeof image !== 'string' ||
        !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(image)
    )
  ) {
    throw new Error(
      'Vstup musí být obrázek PNG, JPEG nebo WebP v datovém formátu.'
    );
  }
  const prompt = String(body.prompt || '').trim();
  if (!prompt) throw new Error('Zadej prompt.');

  const qwen = QWEN[model];
  if (qwen) {
    if (!images.length)
      throw new Error('Qwen Edit vyžaduje alespoň jeden vstupní obrázek.');
    if (images.length > qwen.max)
      throw new Error(
        `Tento Qwen podporuje nejvýše ${qwen.max} vstupních obrázků.`
      );
    if (prompt.length > qwen.promptMax)
      throw new Error(
        `Prompt pro tento Qwen smí mít nejvýše ${qwen.promptMax} znaků.`
      );
    const multi = images.length > 1;
    const payload = multi
      ? { modelId: qwen.id, images, prompt }
      : { model: qwen.id, image: images[0], prompt };
    payload.safe_mode = false;
    payload.output_format = 'png';
    if (body.aspectRatio && body.aspectRatio !== 'Original') {
      if (
        ![
          '1:1',
          '3:2',
          '16:9',
          '21:9',
          '9:16',
          '2:3',
          '3:4',
          '4:3',
          '4:5',
        ].includes(body.aspectRatio)
      )
        throw new Error('Tento poměr stran Qwen nepodporuje.');
      payload.aspect_ratio = body.aspectRatio;
    }
    if (qwen.id !== 'qwen-edit-uncensored' && body.resolution) {
      if (!['1K', '2K'].includes(body.resolution))
        throw new Error('Qwen Turbo a Pro podporují rozlišení 1K nebo 2K.');
      payload.resolution = body.resolution;
    }
    const image = await request(
      `https://api.venice.ai/api/v1/image/${multi ? 'multi-edit' : 'edit'}`,
      providerKey('venice', body.externalApiKey),
      payload,
      true
    );
    return { imageBase64: image, modelId: model };
  }
  if (model === 'venice/lustify-v8') {
    if (images.length)
      throw new Error(
        'Lustify v8 zde podporuje pouze generování z textu. Úpravy fotek nejsou v jeho API doložené. Vyber Qwen nebo Runware.'
      );
    if (prompt.length > 1500)
      throw new Error('Prompt Lustify smí mít nejvýše 1500 znaků.');
    const data = await request(
      'https://api.venice.ai/api/v1/image/generate',
      providerKey('venice', body.externalApiKey),
      {
        model: 'lustify-v8',
        prompt,
        ...dimensions(body),
        format: 'png',
        return_binary: false,
        safe_mode: false,
      }
    );
    const image = data?.images?.[0];
    if (typeof image !== 'string' || !image)
      throw new Error('Lustify nevrátil obrázek.');
    return {
      imageBase64: image.startsWith('data:image/')
        ? image
        : `data:image/png;base64,${image}`,
      modelId: model,
    };
  }
  if (images.length > 1)
    throw new Error(
      'Runware SDXL přijímá jeden vstup. Nejprve slož obrázky do jedné koláže.'
    );
  if (prompt.length < 2 || prompt.length > 3000)
    throw new Error('Prompt Runware musí mít 2 až 3000 znaků.');
  const air = String(
    body.runwareModel || process.env.RUNWARE_IMAGE_MODEL || ''
  ).trim();
  if (!/^[a-zA-Z0-9_-]+:\d+@\d+$/.test(air))
    throw new Error(
      'V nastavení Runware zadej AIR identifikátor vybraného SDXL modelu.'
    );
  const strength = Number(body.strength ?? 0.35);
  if (!Number.isFinite(strength) || strength < 0 || strength > 1)
    throw new Error('Síla změny musí být mezi 0 a 1.');
  const taskUUID = randomUUID();
  const data = await request(
    'https://api.runware.ai/v1',
    providerKey('runware', body.externalApiKey),
    [
      {
        taskType: 'imageInference',
        taskUUID,
        model: air,
        positivePrompt: prompt,
        ...dimensions(body),
        numberResults: 1,
        outputType: 'base64Data',
        outputFormat: 'PNG',
        steps: 30,
        ...(images.length ? { seedImage: images[0], strength } : {}),
      },
    ]
  );
  if (data?.errors?.length)
    throw new Error(
      'Runware odmítl úlohu. Ověř kompatibilitu SDXL modelu a dostupný kredit.'
    );
  const result = data?.data?.find((item) => item.taskUUID === taskUUID);
  const image = result?.imageBase64Data;
  if (typeof image !== 'string' || !image)
    throw new Error('Runware nevrátil obrázek.');
  return {
    imageBase64: image.startsWith('data:image/')
      ? image
      : `data:image/png;base64,${image}`,
    modelId: `runware/${air}`,
  };
}
module.exports = { isExternalModel, generateExternalImage, dimensions, cleanKey };
