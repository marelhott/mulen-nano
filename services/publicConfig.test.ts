import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPublicConfig } from './publicConfig';

describe('fetchPublicConfig', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('předá adresu Workflow editoru z /api/public-config', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      workflowUrl: 'https://mulen-nano-workflow.vercel.app/',
      r2PublicModelsBaseUrl: 'https://models.example.com/',
    })));
    const config = await fetchPublicConfig({ maxAgeMs: 0 });
    expect(config.workflowUrl).toBe('https://mulen-nano-workflow.vercel.app');
    expect(config.r2PublicModelsBaseUrl).toBe('https://models.example.com');
  });

  it('zvládne odpověď bez workflowUrl', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ r2PublicModelsBaseUrl: '' })));
    const config = await fetchPublicConfig({ maxAgeMs: 0 });
    expect(config.workflowUrl).toBe('');
  });
});
