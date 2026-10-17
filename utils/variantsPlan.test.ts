import { describe, expect, it } from 'vitest';
import {
  VARIANTS_GENERAL_PROMPT,
  VARIANTS_MAX_PER_MODEL,
  VARIANT_MODELS,
  buildVariantsPrompt,
  clampVariantCount,
  planVariantTasks,
  variantModelById,
} from './variantsPlan';

describe('variantsPlan', () => {
  it('drží ověřené znění obecného promptu', () => {
    expect(VARIANTS_GENERAL_PROMPT.startsWith('Create a new image from the same series as the attached image')).toBe(true);
    expect(VARIANTS_GENERAL_PROMPT).toContain('KEEP, exactly as in the original:');
    expect(VARIANTS_GENERAL_PROMPT.endsWith('Output one image.')).toBe(true);
  });

  it('vzdálenost přidá jednu větu, nebo nic', () => {
    expect(buildVariantsPrompt('', 'middle')).toBe(VARIANTS_GENERAL_PROMPT);
    expect(buildVariantsPrompt('', 'near').endsWith('slightly different angle.')).toBe(true);
    expect(buildVariantsPrompt('', 'far').endsWith('everything listed under KEEP.')).toBe(true);
  });

  it('divná vzdálenost přidá do promptu větu o podivnosti', () => {
    const text = buildVariantsPrompt('', 'weird');
    expect(text.startsWith(VARIANTS_GENERAL_PROMPT)).toBe(true);
    expect(text).toContain('genuinely weird');
  });

  it('prázdný vlastní prompt spadne na výchozí, neprázdný se použije', () => {
    expect(buildVariantsPrompt('   \n ', 'middle')).toBe(VARIANTS_GENERAL_PROMPT);
    expect(buildVariantsPrompt('  moje  ', 'middle')).toBe('moje');
  });

  it('počet je omezený na 1 až 5', () => {
    expect(clampVariantCount(0)).toBe(1);
    expect(clampVariantCount(4.4)).toBe(4);
    expect(clampVariantCount(99)).toBe(VARIANTS_MAX_PER_MODEL);
    expect(clampVariantCount(Number.NaN)).toBe(1);
  });

  it('plán má úlohy v pořadí modelů a unikátní id', () => {
    const tasks = planVariantTasks(['flux', 'gpt', 'gpt'], 3, (m, i) => `${m}-${i}`);
    expect(tasks.map((t) => t.modelId)).toEqual(['gpt', 'gpt', 'gpt', 'flux', 'flux', 'flux']);
    expect(tasks.map((t) => t.variantIndex)).toEqual([0, 1, 2, 0, 1, 2]);
    expect(new Set(tasks.map((t) => t.id)).size).toBe(6);
  });

  it('všechny osm modelů po pěti dá čtyřicet úloh', () => {
    expect(planVariantTasks(['gpt', 'gemini', 'flux', 'seedream', 'muse', 'grok', 'mai', 'recraft'], 99, (m, i) => `${m}-${i}`)).toHaveLength(40);
    expect(planVariantTasks([], 5, (m, i) => `${m}-${i}`)).toHaveLength(0);
  });

  it('modely sdílejí katalog a posílají jen podporované rozlišení', () => {
    expect(VARIANT_MODELS).toHaveLength(14);
    expect(new Set(VARIANT_MODELS.map((item) => item.model)).size).toBe(14);
    expect(variantModelById('flux').resolution).toBe('1K');
    expect(variantModelById('seedream').resolution).toBe('1K');
    expect(variantModelById('gpt').resolution).toBeUndefined();
    expect(variantModelById('qwen-pro').model).toBe('venice/qwen-image-2-1-pro-edit');
  });
});
