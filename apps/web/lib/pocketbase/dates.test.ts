import { describe, expect, it, vi } from 'vitest';
import { parsePbDate, pbDate, pbDateLabel } from './dates';
import { safariDate } from '@/test-utils/safariDate';

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

describe('pbDateLabel', () => {
  it('shows a real date for the PocketBase format, even where new Date() cannot read it', () => {
    const value = '2026-10-23 12:00:00.000Z';
    const want = new Date('2026-10-23T12:00:00.000Z');
    vi.stubGlobal('Date', safariDate());
    try {
      expect(new Date(value).toString()).toBe('Invalid Date');
      expect(pbDateLabel(value)).toBe(want.toLocaleDateString());
      expect(pbDateLabel(value, true)).toBe(want.toLocaleString());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('is empty, not "Invalid Date", for a value it cannot read', () => {
    expect(pbDateLabel('')).toBe('');
    expect(pbDateLabel('soon')).toBe('');
    expect(pbDateLabel(undefined)).toBe('');
  });
});
