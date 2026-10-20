const json = (res, status, body) => {
  res.status(status);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.json(body);
};

export default function handler(req, res) {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  json(res, 200, {
    r2PublicModelsBaseUrl: String(process.env.R2_PUBLIC_MODELS_BASE_URL || '').trim(),
    r2PublicLorasBaseUrl: String(process.env.R2_PUBLIC_LORAS_BASE_URL || '').trim(),
    workflowUrl: String(process.env.WORKFLOW_PUBLIC_URL || '').trim().replace(/\/+$/, ''),
    openRouter: Boolean(String(process.env.OPENROUTER_API_KEY || '').trim()),
    venice: Boolean(String(process.env.VENICE_API_KEY || '').trim()),
  });
}
