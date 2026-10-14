import { describe, expect, it } from 'vitest';
import { COLLAGE_GENERAL_PROMPT, COLLAGE_MAX_PER_MODEL, buildCollagePrompt, collageInputBudget } from './collagePlan';

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
});
