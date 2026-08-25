const { getOpenRouterKey, validateKey } = require('../../lib/openrouter.cjs');

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { success: false, error: 'Method not allowed' });
  try {
    const body = JSON.parse(event.body || '{}');
    const apiKey = String(body.apiKey || getOpenRouterKey()).trim();
    if (!apiKey) return json(400, { success: false, error: 'OPENROUTER_API_KEY není nastavený.' });
    await validateKey(apiKey);
    return json(200, { success: true });
  } catch (error) {
    return json(401, { success: false, error: error?.message || 'OpenRouter key validation failed' });
  }
};
