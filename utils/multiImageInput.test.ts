import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareReferenceImages } from './multiImageInput';
import { optimizeVariantsInput } from './variantsInput';
import { COLLAGE_MAX_SOURCES } from './collagePlan';

vi.mock('./variantsInput', () => ({ optimizeVariantsInput: vi.fn() }));

describe('společné vstupy variant a koláží', () => {
  beforeEach(() => {
    vi.mocked(optimizeVariantsInput).mockReset();
    vi.mocked(optimizeVariantsInput).mockImplementation(async (data, mimeType) => ({ data, mimeType }));
  });

  it('připraví všech deset referencí v původním pořadí, ne deset samostatných generování', async () => {
    const sources = Array.from({ length: 10 }, (_, i) => ({ name: `${i}.jpg`, dataUrl: `image-${i}`, mimeType: 'image/jpeg' }));
    const inputs = await prepareReferenceImages(sources);
    expect(COLLAGE_MAX_SOURCES).toBe(10);
    expect(inputs.map((item) => item.data)).toEqual(sources.map((item) => item.dataUrl));
    expect(optimizeVariantsInput).toHaveBeenCalledTimes(10);
    expect(optimizeVariantsInput).toHaveBeenCalledWith('image-9', 'image/jpeg', { targetBytes: 280_000, maxDimension: 1400 });
  });

  it('nevynechá tiše jedenáctý vstup a nepovolí prázdnou sadu', async () => {
    await expect(prepareReferenceImages([])).rejects.toThrow('1 až 10');
    await expect(prepareReferenceImages(Array.from({ length: 11 }, () => ({ name: 'x', dataUrl: 'x', mimeType: 'image/jpeg' }))))
      .rejects.toThrow('1 až 10');
    expect(optimizeVariantsInput).not.toHaveBeenCalled();
  });

  it('zastaví nadměrný požadavek před odesláním na Vercel', async () => {
    vi.mocked(optimizeVariantsInput).mockResolvedValue({ data: 'x'.repeat(4_000_001), mimeType: 'image/jpeg' });
    await expect(prepareReferenceImages([{ name: 'x', dataUrl: 'x', mimeType: 'image/jpeg' }])).rejects.toThrow('příliš velké');
  });
});
