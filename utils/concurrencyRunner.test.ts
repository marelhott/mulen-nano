import { afterEach, describe, expect, it, vi } from 'vitest';
import { isCreditHoldError, runConcurrentTasks } from './concurrencyRunner';

const creditError = new Error('This request would exceed your available credits given your current in-flight requests. Retry after in-flight requests settle, or add credits.');

describe('retry při zablokovaném kreditu', () => {
  afterEach(() => vi.useRealTimers());

  it('pozná chybu OpenRouter o kreditu držené souběžnými požadavky', () => {
    expect(isCreditHoldError(creditError)).toBe(true);
    expect(isCreditHoldError(new Error('Safety system'))).toBe(false);
  });

  it('úlohu zopakuje i po třech pokusech, dokud se kredit neuvolní', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const promise = runConcurrentTasks({
      items: ['a'],
      concurrency: 1,
      worker: async () => { calls += 1; if (calls < 5) throw creditError; return 'ok'; },
    });
    await vi.runAllTimersAsync();
    const [result] = await promise;
    expect(result.status).toBe('fulfilled');
    expect(calls).toBe(5);
  });
});
