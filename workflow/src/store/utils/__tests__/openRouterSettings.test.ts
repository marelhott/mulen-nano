import { describe, expect, it } from 'vitest';
import { defaultProviderSettings } from '../localStorage';

describe('OpenRouter workflow settings', () => {
  it('expose exactly one AI gateway', () => {
    expect(Object.keys(defaultProviderSettings.providers)).toEqual(['openrouter']);
    expect(defaultProviderSettings.providers.openrouter.apiKey).toBeNull();
  });
});
