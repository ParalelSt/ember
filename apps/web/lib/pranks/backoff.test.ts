import { describe, expect, it } from 'vitest';
import { BACKOFF_BASE_MS, BACKOFF_MAX_MS, createBackoff } from './backoff';

describe('backoff', () => {
  it('doubles from 5 s to a 60 s cap and resets on success', () => {
    const b = createBackoff();
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) { b.fail(null, 0); waits.push(b.remaining(0)); }
    expect(waits).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
    expect(waits[0]).toBe(BACKOFF_BASE_MS);
    expect(Math.max(...waits)).toBe(BACKOFF_MAX_MS);
    b.ok();
    expect(b.blocked(0)).toBe(false);
  });
  it('prefers Retry-After', () => {
    const b = createBackoff();
    b.fail(42_000, 0);
    expect(b.remaining(0)).toBe(42_000);
  });
});
