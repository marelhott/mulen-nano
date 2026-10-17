import { describe, expect, it } from 'vitest';
import { COLLAGE_GENERAL_PROMPT, COLLAGE_MAX_PER_MODEL, buildCollageEditInstruction, buildCollagePrompt, collageInputBudget, rotateInputs } from './collagePlan';

describe('collagePlan', () => {
  it('prázdný prompt spadne na výchozí, vlastní se použije', () => {
    expect(buildCollagePrompt('  ')).toBe(COLLAGE_GENERAL_PROMPT);
    expect(buildCollagePrompt(' moje ')).toBe('moje');
  });

  it('prompt chce jedno sjednocené dílo, ne doslovnou koláž, a heslo méně je více', () => {
    expect(COLLAGE_GENERAL_PROMPT).toContain('LESS IS MORE');
    expect(COLLAGE_GENERAL_PROMPT).toContain('IT MUST NOT LOOK LIKE A COLLAGE');
    expect(COLLAGE_MAX_PER_MODEL).toBe(5);
  });

  it('rozpočet vstupů se dělí mezi obrázky', () => {
    expect(collageInputBudget(2).targetBytes).toBeGreaterThan(collageInputBudget(6).targetBytes);
    expect(collageInputBudget(6).targetBytes * 6).toBeLessThanOrEqual(4_200_000);
  });

  it('instrukce pro Qwen se odkazuje na číslované obrázky a vejde se do limitu 1500 znaků', () => {
    expect(buildCollageEditInstruction(2)).toContain('merges with image 2');
    expect(buildCollageEditInstruction(3)).toContain('images 2 and 3');
    for (const n of [2, 3, 6]) expect(buildCollageEditInstruction(n).length).toBeLessThan(1500);
  });

  it('rotace vstupů střídá základní obrázek', () => {
    expect(rotateInputs(['a', 'b', 'c'], 0)).toEqual(['a', 'b', 'c']);
    expect(rotateInputs(['a', 'b', 'c'], 1)).toEqual(['b', 'c', 'a']);
    expect(rotateInputs(['a', 'b', 'c'], 4)).toEqual(['b', 'c', 'a']);
    expect(rotateInputs([], 3)).toEqual([]);
  });
});
