// Lokální identita zařízení. Nahrazuje původní Supabase Auth identitu:
// vzdálené úložiště je pouze Cloudflare R2 za PINem, cloudové účty ani anonymní
// přihlášení už aplikace nepoužívá.

const APP_USER_ID_STORAGE_KEY = 'userId';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getCurrentUserId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(APP_USER_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistAppUserId(userId: string): void {
  try {
    window.localStorage.setItem(APP_USER_ID_STORAGE_KEY, userId);
  } catch {
    // Soukromý režim může zápis zakázat; identita pak platí jen pro tuto relaci.
  }
}

export function ensureLocalAppUserId(): string {
  const existing = getCurrentUserId();
  if (existing && UUID_PATTERN.test(existing)) return existing;

  const next =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : '';

  if (!next) {
    throw new Error('Pro lokální ID zařízení je potřeba prostředí s crypto.randomUUID().');
  }

  persistAppUserId(next);
  return next;
}

export function clearLocalAppUserId(): void {
  try {
    window.localStorage.removeItem(APP_USER_ID_STORAGE_KEY);
  } catch {
    // ignore
  }
}
