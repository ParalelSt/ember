import { describe, it, expect } from 'vitest';
import { storageBarModel } from './storageBar';

describe('storageBarModel', () => {
  it('splits the bar between the two parts when no total space is known', () => {
    const m = storageBarModel({ downloadsBytes: 150, cacheBytes: 50 });
    expect(m.totalBytes).toBe(200);
    expect(m.downloadsPct).toBeCloseTo(75);
    expect(m.cachePct).toBeCloseTo(25);
    expect(m.freeBytes).toBeNull();
  });

  it('scales to the quota and reports free space when it is known', () => {
    const m = storageBarModel({ downloadsBytes: 100, cacheBytes: 100, quotaBytes: 1000, usageBytes: 400 });
    expect(m.downloadsPct).toBeCloseTo(10);
    expect(m.cachePct).toBeCloseTo(10);
    expect(m.freeBytes).toBe(600);
  });

  it('never reports free space below zero', () => {
    expect(storageBarModel({ downloadsBytes: 10, cacheBytes: 0, quotaBytes: 100, usageBytes: 500 }).freeBytes).toBe(0);
  });

  it('treats a zero or missing quota as unknown', () => {
    expect(storageBarModel({ downloadsBytes: 10, cacheBytes: 10, quotaBytes: 0 }).freeBytes).toBeNull();
    expect(storageBarModel({ downloadsBytes: 10, cacheBytes: 10, quotaBytes: null }).freeBytes).toBeNull();
  });

  it('is empty with nothing stored and no quota', () => {
    const m = storageBarModel({ downloadsBytes: 0, cacheBytes: 0 });
    expect(m).toEqual({ totalBytes: 0, downloadsPct: 0, cachePct: 0, freeBytes: null });
  });

  it('keeps a tiny part visible without overflowing the bar', () => {
    const m = storageBarModel({ downloadsBytes: 1, cacheBytes: 100000, quotaBytes: 1e12 });
    expect(m.downloadsPct).toBeGreaterThanOrEqual(1);
    expect(m.downloadsPct + m.cachePct).toBeLessThanOrEqual(100.0001);
    const full = storageBarModel({ downloadsBytes: 1, cacheBytes: 1e9 });
    expect(full.downloadsPct + full.cachePct).toBeCloseTo(100);
  });
});
