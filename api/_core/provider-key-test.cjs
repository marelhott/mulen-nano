const { getOpenRouterKey, validateKey } = require('../../lib/openrouter.cjs');
const { json, denyUnauthorized } = require('../../lib/apiAuth.cjs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { success: false, error: 'Method not allowed' });
  try {
    const body = JSON.parse(event.body || '{}');
    const apiKey = String(body.apiKey || getOpenRouterKey()).trim();
    // Test serverového klíče je citlivý; test vlastního klíče PIN nevyžaduje.
    if (!String(body.apiKey || '').trim()) {
      const unauthorized = denyUnauthorized(event);
      if (unauthorized) return unauthorized;
    }
    if (!apiKey) return json(400, { success: false, error: 'OPENROUTER_API_KEY není nastavený.' });
    await validateKey(apiKey);
    return json(200, { success: true });
  } catch (error) {
    return json(401, { success: false, error: error?.message || 'OpenRouter key validation failed' });
  }
};
