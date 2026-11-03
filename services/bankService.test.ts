import { afterEach, describe, expect, it, vi } from 'vitest';
import { commitBankItem } from './bankService';
import { emptyBankIndex, type BankIndex, type BankItem } from '../utils/bankIndex';

const makeItem = (n: number): BankItem => ({ id: `item-${n}`, kind: 'image', title: `Obrázek ${n}`, folderId: 'inbox', tags: [], createdAt: n, contentHash: `hash-${n}` });

describe('commitBankItem', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('souběžné položky zapíše dávkově, přežije konflikt revize a žádnou neztratí', async () => {
    let stored: BankIndex = emptyBankIndex();
    let puts = 0;
    let injectConflict = true;
    vi.stubGlobal('window', { dispatchEvent: () => true, localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      if (body.op === 'index-get') return Response.json({ index: stored });
      if (body.op === 'index-put') {
        puts += 1;
        if (injectConflict) {
          // jiný klient mezitím změnil index
          injectConflict = false;
          stored = { ...stored, rev: stored.rev + 1 };
          return Response.json({ error: 'konflikt', index: stored }, { status: 409 });
        }
        if (body.index.rev !== stored.rev + 1) return Response.json({ error: 'konflikt', index: stored }, { status: 409 });
        stored = body.index;
        return Response.json({ rev: stored.rev });
      }
      return Response.json({ error: 'neznámá operace' }, { status: 400 });
    }));

    const items = [1, 2, 3, 4, 5].map(makeItem);
    const results = await Promise.all(items.map((item) => commitBankItem(item, 'library')));

    expect(results.every((result, i) => result.retained.id === items[i].id)).toBe(true);
    expect(stored.items.map((item) => item.id).sort()).toEqual(items.map((item) => item.id).sort());
    expect(puts).toBeLessThanOrEqual(2);
  });

  it('duplicitní obsah v indexu vrátí existující položku a nepřidá novou', async () => {
    const existing = makeItem(1);
    let stored: BankIndex = { ...emptyBankIndex(), items: [existing] };
    vi.stubGlobal('window', { dispatchEvent: () => true });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      if (body.op === 'index-get') return Response.json({ index: stored });
      stored = body.index;
      return Response.json({ rev: stored.rev });
    }));
    const result = await commitBankItem({ ...makeItem(9), contentHash: existing.contentHash }, 'library');
    expect(result.retained.id).toBe(existing.id);
    expect(stored.items).toHaveLength(1);
  });
});
