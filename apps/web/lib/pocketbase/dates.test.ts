import { describe, expect, it } from 'vitest';
import { parsePbDate, pbDate } from './dates';

describe('PocketBase dates', () => {
  it('writes the space-separated format and reads it back', () => {
    const at = Date.UTC(2026, 9, 7, 12, 3, 0);
    expect(pbDate(at)).toBe('2026-10-07 12:03:00.000Z');
    expect(parsePbDate(pbDate(at))).toBe(at);
  });

  it('reads an ISO date too', () => {
    expect(parsePbDate('2026-10-07T12:03:00.000Z')).toBe(Date.UTC(2026, 9, 7, 12, 3, 0));
  });

  it('is NaN for empty or non-string values', () => {
    expect(parsePbDate('')).toBeNaN();
    expect(parsePbDate(null)).toBeNaN();
    expect(parsePbDate(42)).toBeNaN();
  });
});
