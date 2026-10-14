import { bankLogin, bankLogout, getBankToken } from './bankService';

type R2PresignResponse = {
  signedUrl: string;
  objectUrl: string;
  bucket: string;
  key: string;
  expires: number;
};

// Sdílené přihlášení s Databankou: /api/r2-presign vyžaduje token. Souběžná volání (více LoRA najednou)
// čekají na jediný dotaz na heslo.
let loginInFlight: Promise<void> | null = null;

async function ensureLogin(): Promise<void> {
  if (getBankToken()) return;
  if (!loginInFlight) {
    loginInFlight = (async () => {
      const passphrase = typeof window !== 'undefined' ? window.prompt('Heslo k úložišti LoRA/modelů (stejné jako do Databanky):') : null;
      if (!passphrase) throw new Error('R2: chybí přihlášení (zadej heslo).');
      await bankLogin(passphrase);
    })().finally(() => {
      loginInFlight = null;
    });
  }
  await loginInFlight;
}

async function postPresign(params: object): Promise<Response> {
  await ensureLogin();
  return fetch('/api/r2-presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getBankToken()}` },
    body: JSON.stringify(params),
  });
}

export async function presignR2(params: {
  op: 'get' | 'put';
  bucket?: string;
  key: string;
  expires?: number;
}): Promise<R2PresignResponse> {
  let res = await postPresign(params);
  if (res.status === 401) {
    // Token vypršel nebo se změnilo heslo: přihlásit znovu a zkusit ještě jednou.
    bankLogout();
    res = await postPresign(params);
  }

  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const j = JSON.parse(text);
      detail = j?.error || j?.detail || j?.message || text;
      if (typeof detail !== 'string') detail = JSON.stringify(detail);
    } catch {
      // keep raw text
    }
    throw new Error(`R2 presign selhal (HTTP ${res.status}): ${String(detail).slice(0, 500)}`);
  }

  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('R2 presign vrátil neplatnou odpověď (není to JSON).');
  }

  const signedUrl = String(payload?.signedUrl || '').trim();
  const objectUrl = String(payload?.objectUrl || '').trim();
  const bucket = String(payload?.bucket || '').trim();
  const key = String(payload?.key || '').trim();
  const expires = Number(payload?.expires || 0);
  if (!signedUrl || !objectUrl || !bucket || !key) throw new Error('R2 presign: chybí data v odpovědi.');
  return { signedUrl, objectUrl, bucket, key, expires };
}

export function isR2Ref(path: string): boolean {
  const v = String(path || '').trim();
  return v.startsWith('r2://') || v.startsWith('r2:');
}

export function r2KeyFromRef(path: string): string {
  const v = String(path || '').trim();
  if (v.startsWith('r2://')) return v.slice('r2://'.length);
  if (v.startsWith('r2:')) return v.slice('r2:'.length);
  return v;
}

export function parseR2Ref(path: string): { bucket?: 'loras' | 'models'; key: string } {
  const v = String(path || '').trim();
  const raw = v.startsWith('r2://') ? v.slice('r2://'.length) : v.startsWith('r2:') ? v.slice('r2:'.length) : v;
  const trimmed = raw.replace(/^\/+/, '');
  const parts = trimmed.split('/').filter(Boolean);
  const bucket = parts[0] === 'loras' || parts[0] === 'models' ? (parts[0] as 'loras' | 'models') : undefined;
  const rest = bucket ? parts.slice(1).join('/') : parts.join('/');
  // Back-compat: older uploads used "loras/<file>" inside bucket loras.
  if (bucket === 'loras' && rest && !rest.startsWith('loras/')) {
    return { bucket, key: `loras/${rest}` };
  }
  return { bucket, key: rest };
}
