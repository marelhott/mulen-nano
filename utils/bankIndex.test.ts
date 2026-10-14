import { describe, expect, it } from 'vitest';
import {
  BANK_INBOX_ID,
  addFolder,
  addItem,
  deleteFolder,
  emptyBankIndex,
  filterItems,
  folderPath,
  moveFolder,
  moveItems,
  parseTags,
  removeItems,
  tagCounts,
  updateItem,
  type BankItem,
} from './bankIndex';

const item = (id: string, patch: Partial<BankItem> = {}): BankItem => ({
  id,
  kind: 'note',
  title: id,
  folderId: BANK_INBOX_ID,
  tags: [],
  createdAt: 1,
  ...patch,
});

describe('bankIndex', () => {
  it('prázdný index má složku Doručené', () => {
    expect(emptyBankIndex().folders.map((f) => f.id)).toEqual([BANK_INBOX_ID]);
  });

  it('štítky se normalizují a deduplikují', () => {
    expect(parseTags('#Modrá, textura\nmodrá,  Hustá  vrstva ')).toEqual(['modrá', 'textura', 'hustá-vrstva']);
  });

  it('smazání složky přesune položky do nadřazené, kořen do Doručených', () => {
    let index = emptyBankIndex();
    index = addFolder(index, { id: 'a', name: 'Portréty', parentId: null });
    index = addFolder(index, { id: 'b', name: 'Světlo', parentId: 'a' });
    index = addItem(index, item('x', { folderId: 'b' }));
    expect(deleteFolder(index, 'b').items[0].folderId).toBe('a');
    const root = deleteFolder(index, 'a');
    expect(root.items[0].folderId).toBe(BANK_INBOX_ID);
    expect(root.folders.map((f) => f.id)).toEqual([BANK_INBOX_ID]);
  });

  it('Doručené nejde smazat a složku nejde přesunout do sebe ani do potomka', () => {
    let index = emptyBankIndex();
    index = addFolder(index, { id: 'a', name: 'A', parentId: null });
    index = addFolder(index, { id: 'b', name: 'B', parentId: 'a' });
    expect(deleteFolder(index, BANK_INBOX_ID)).toBe(index);
    expect(moveFolder(index, 'a', 'b')).toBe(index);
    expect(moveFolder(index, 'b', null).folders.find((f) => f.id === 'b')?.parentId).toBeNull();
  });

  it('filtr bere složku včetně podsložek, štítek i text', () => {
    let index = emptyBankIndex();
    index = addFolder(index, { id: 'a', name: 'A', parentId: null });
    index = addFolder(index, { id: 'b', name: 'B', parentId: 'a' });
    index = addItem(index, item('x', { folderId: 'b', tags: ['modrá'], text: 'mlha nad vodou', createdAt: 5 }));
    index = addItem(index, item('y', { folderId: BANK_INBOX_ID, createdAt: 9 }));
    expect(filterItems(index, { folderId: 'a' }).map((i) => i.id)).toEqual(['x']);
    expect(filterItems(index, { folderId: null }).map((i) => i.id)).toEqual(['y', 'x']);
    expect(filterItems(index, { folderId: null, tag: 'modrá' }).map((i) => i.id)).toEqual(['x']);
    expect(filterItems(index, { folderId: null, query: 'MLHA' }).map((i) => i.id)).toEqual(['x']);
  });

  it('položka s neznámou složkou spadne do Doručených; přesun do neznámé složky nic nedělá', () => {
    let index = emptyBankIndex();
    index = addItem(index, item('x', { folderId: 'neexistuje' }));
    expect(index.items[0].folderId).toBe(BANK_INBOX_ID);
    expect(moveItems(index, ['x'], 'nikde')).toBe(index);
    expect(updateItem(index, 'x', { folderId: 'nikde' }).items[0].folderId).toBe(BANK_INBOX_ID);
  });

  it('odstranění vrací smazané položky a štítky se počítají', () => {
    let index = emptyBankIndex();
    index = addItem(index, item('x', { tags: ['a', 'b'] }));
    index = addItem(index, item('y', { tags: ['a'] }));
    expect(tagCounts(index.items)).toEqual([{ tag: 'a', count: 2 }, { tag: 'b', count: 1 }]);
    const { index: next, removed } = removeItems(index, ['x']);
    expect(removed.map((i) => i.id)).toEqual(['x']);
    expect(next.items.map((i) => i.id)).toEqual(['y']);
  });

  it('cesta ke složce jde od kořene', () => {
    let index = emptyBankIndex();
    index = addFolder(index, { id: 'a', name: 'A', parentId: null });
    index = addFolder(index, { id: 'b', name: 'B', parentId: 'a' });
    expect(folderPath(index, 'b').map((f) => f.name)).toEqual(['A', 'B']);
  });
});
