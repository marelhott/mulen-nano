import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bankLogin, bankLogout, getBankToken, hasBankToken, rememberBankSession } from './bankService';

let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => vi.unstubAllGlobals());

describe('Zapamatované přihlášení knihovny', () => {
  it('uloží token, nikoli PIN, a neodhlásí po původních 30 dnech', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: 'signed-token', expiresAt: null }))));
    await bankLogin('654321');
    expect(getBankToken()).toBe('signed-token');
    expect(storage.get('bank.token')).not.toContain('654321');
    const now = vi.spyOn(Date, 'now').mockReturnValue(9e15);
    expect(hasBankToken()).toBe(true);
    now.mockRestore();
    bankLogout();
    expect(hasBankToken()).toBe(false);
  });
  it('převede dosud platný starý token bez znovuzadání PINu', async () => {
    storage.set('bank.token', JSON.stringify({ token: 'old-token', expiresAt: Date.now() + 60000 }));
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: 'persistent-token', expiresAt: null })));
    vi.stubGlobal('fetch', fetch);
    await rememberBankSession();
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer old-token');
    expect(getBankToken()).toBe('persistent-token');
    await rememberBankSession();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('prošlé a poškozené přihlášení nepřijímá ani neobnovuje', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const value of ['invalid-json', JSON.stringify({ token: 'expired', expiresAt: 1 }), JSON.stringify({ token: 'missing-expiry' })]) {
      storage.set('bank.token', value);
      expect(hasBankToken()).toBe(false);
      await rememberBankSession();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
