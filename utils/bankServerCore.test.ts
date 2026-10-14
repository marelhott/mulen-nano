import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const core = createRequire(import.meta.url)('./bankServerCore.cjs');

describe('bankServerCore', () => {
  it('token projde jen s tajemstvím, před vypršením a bez úprav', () => {
    const { token, expiresAt } = core.signToken('tajemstvi', 1000, 5000);
    expect(expiresAt).toBe(6000);
    expect(core.verifyToken('tajemstvi', token, 5999)).toBe(true);
    expect(core.verifyToken('tajemstvi', token, 6000)).toBe(false);
    expect(core.verifyToken('jine', token, 2000)).toBe(false);
    const [payload, signature] = token.split('.');
    const forged = `${Buffer.from(JSON.stringify({ exp: 9e15 })).toString('base64url')}.${signature}`;
    expect(core.verifyToken('tajemstvi', forged, 2000)).toBe(false);
    expect(core.verifyToken('tajemstvi', `${payload}.${signature}.x`, 2000)).toBe(false);
    expect(core.verifyToken('', token, 2000)).toBe(false);
    expect(core.verifyToken('tajemstvi', undefined, 2000)).toBe(false);
  });

  it('heslo se porovná přesně a prázdné nikdy neprojde', () => {
    expect(core.checkPassphrase('dlouhe-heslo', 'dlouhe-heslo')).toBe(true);
    expect(core.checkPassphrase('dlouhe-hesl', 'dlouhe-heslo')).toBe(false);
    expect(core.checkPassphrase('', '')).toBe(false);
    expect(core.checkPassphrase('x', '')).toBe(false);
  });

  it('bearer token se vyčte z hlavičky', () => {
    expect(core.bearerToken({ authorization: 'Bearer abc.def' })).toBe('abc.def');
    expect(core.bearerToken({})).toBe('');
  });

  it('klíče vznikají jen v povolených předponách a typech', () => {
    const keys = core.newObjectKeys('image/png', () => '123e4567-e89b-12d3-a456-426614174000');
    expect(keys).toEqual({
      id: '123e4567-e89b-12d3-a456-426614174000',
      itemKey: 'items/123e4567-e89b-12d3-a456-426614174000.png',
      thumbKey: 'thumbs/123e4567-e89b-12d3-a456-426614174000.jpg',
    });
    expect(core.newObjectKeys('image/svg+xml')).toBeNull();
    expect(core.isBankKey(keys.itemKey)).toBe(true);
    for (const bad of ['index.json', '../items/x.png', 'items/../index.json', 'loras/123e4567-e89b-12d3-a456-426614174000.png', 'items/abc.png', '']) {
      expect(core.isBankKey(bad)).toBe(false);
    }
  });

  it('předpodepsaný odkaz je deterministický a Content-Type je v podpisu', () => {
    const base = { method: 'PUT', accountId: 'acc', bucket: 'bank', key: 'items/123e4567-e89b-12d3-a456-426614174000.png', accessKeyId: 'AKID', secretAccessKey: 'sekret', expires: 900, now: new Date('2026-10-14T12:00:00Z') };
    const a = core.presignObject({ ...base, contentType: 'image/png' });
    expect(a).toBe(core.presignObject({ ...base, contentType: 'image/png' }));
    expect(a.startsWith('https://acc.r2.cloudflarestorage.com/bank/items/')).toBe(true);
    expect(a).toContain('X-Amz-SignedHeaders=content-type%3Bhost');
    expect(a).toContain('X-Amz-Date=20261014T120000Z');
    const b = core.presignObject({ ...base, contentType: 'image/jpeg' });
    expect(new URL(a).searchParams.get('X-Amz-Signature')).not.toBe(new URL(b).searchParams.get('X-Amz-Signature'));
    expect(core.presignObject({ ...base })).toContain('X-Amz-SignedHeaders=host&');
  });

  it('validace indexu odmítne cizí klíče a špatný tvar', () => {
    const ok = { version: 1, rev: 1, folders: [], items: [{ id: 'a', itemKey: 'items/123e4567-e89b-12d3-a456-426614174000.png' }] };
    expect(core.validateIndex(ok)).toBeNull();
    expect(core.validateIndex({ ...ok, items: [{ id: 'a', itemKey: 'index.json' }] })).toMatch(/klíč/);
    expect(core.validateIndex({ ...ok, version: 2 })).toMatch(/verze/);
    expect(core.validateIndex({ ...ok, rev: -1 })).toMatch(/revize/);
    expect(core.validateIndex(null)).toMatch(/objekt/);
    expect(core.validateIndex({ ...ok, items: 'x' })).toMatch(/položky/);
  });
});
