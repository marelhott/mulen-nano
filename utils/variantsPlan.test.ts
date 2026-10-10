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

  it('prázdný vlastní prompt spadne na výchozí, neprázdný se použije', () => {
    expect(buildVariantsPrompt('   \n ', 'middle')).toBe(VARIANTS_GENERAL_PROMPT);
    expect(buildVariantsPrompt('  moje  ', 'middle')).toBe('moje');
  });

  it('počet je omezený na 1 až 10', () => {
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

  it('všechny čtyři modely po deseti dají čtyřicet úloh', () => {
    expect(planVariantTasks(['gpt', 'gemini', 'flux', 'seedream'], 99, (m, i) => `${m}-${i}`)).toHaveLength(40);
    expect(planVariantTasks([], 5, (m, i) => `${m}-${i}`)).toHaveLength(0);
  });

  it('modely mají OpenRouter slugy a FLUX nedostává rozlišení', () => {
    expect(VARIANT_MODELS.map((m) => m.model)).toEqual([
      'openai/gpt-image-2.5-sunburst',
      'google/gemini-nano-banana-2.1',
      'black-forest-labs/flux-3-image',
      'bytedance-seed/seedream-5-0-pro',
    ]);
    expect(variantModelById('flux').resolution).toBeUndefined();
    expect(variantModelById('seedream').resolution).toBeUndefined();
    expect(variantModelById('gpt').resolution).toBe('1K');
  });
});
