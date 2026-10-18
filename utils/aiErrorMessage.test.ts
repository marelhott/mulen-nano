import { describe, expect, it } from 'vitest';
import { toUserFacingAiError } from './aiErrorMessage';

describe('toUserFacingAiError', () => {
  it('překládá síťové chyby do srozumitelné hlášky', () => {
    expect(toUserFacingAiError(new Error('Failed to fetch'))).toContain('Spojení se serverem');
  });

  it('pozná příliš velký payload', () => {
    expect(toUserFacingAiError('FUNCTION_PAYLOAD_TOO_LARGE')).toContain('příliš velké');
  });

  it('rozpozná skutečné odmítnutí bezpečnostním filtrem poskytovatele', () => {
    const error = new Error('Your request was rejected by the safety system. safety_violations=[sexu…');
    expect(toUserFacingAiError(error)).toBe('Poskytovatel odmítl vstupní obrázek nebo zadání svým bezpečnostním filtrem.');
  });

  it('kvótu Google nezamění za nedostatek peněz na OpenRouteru', () => {
    const error = new Error('You exceeded your current quota, please check your plan and billing details. https://ai.google.dev/gemini-api/docs/rate-limits');
    expect(toUserFacingAiError(error)).toContain('kvótu u Google AI Studio');
    expect(toUserFacingAiError(error)).not.toContain('billing');
  });

  it('vrátí fallback pro prázdnou chybu', () => {
    expect(toUserFacingAiError('')).toBe('Generování selhalo. Zkus to prosím znovu.');
  });
});
