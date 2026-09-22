import { describe, expect, it } from 'vitest';
import { syntheticLikedAt, transferBase, TRANSFER_GAP_MS } from '@/lib/import/likedAt';

const JOB = Date.UTC(2026, 8, 22, 12, 0, 0);
const OLDEST = Date.UTC(2025, 0, 1, 0, 0, 0);

describe('transferBase', () => {
  it('sits a clear minute below the oldest like the person already has', () => {
    expect(transferBase(OLDEST, JOB)).toBe(OLDEST - TRANSFER_GAP_MS);
  });

  it('falls back to the job itself for someone with no likes yet', () => {
    expect(transferBase(null, JOB)).toBe(JOB - TRANSFER_GAP_MS);
  });

  it('never dates a transfer above the job, even with a like stamped in the future', () => {
    expect(transferBase(JOB + 999_999, JOB)).toBe(JOB - TRANSFER_GAP_MS);
  });
});

describe('syntheticLikedAt', () => {
  const base = transferBase(OLDEST, JOB);

  it('a newest-first source keeps its order, a second apart', () => {
    const dates = [0, 1, 2].map((p) => syntheticLikedAt(base, 'newest-first', 3, p));
    expect(dates).toEqual([base, base - 1000, base - 2000]);
  });

  it('an oldest-first source is turned around, so the list still reads newest first', () => {
    const dates = [0, 1, 2].map((p) => syntheticLikedAt(base, 'oldest-first', 3, p));
    expect(dates).toEqual([base - 2000, base - 1000, base]);
  });

  it('an unknown order is treated as newest-first', () => {
    expect(syntheticLikedAt(base, 'unknown', 3, 1)).toBe(syntheticLikedAt(base, 'newest-first', 3, 1));
  });

  it('every song of a transfer lands below every real like', () => {
    const dates = Array.from({ length: 5000 }, (_, p) => syntheticLikedAt(base, 'newest-first', 5000, p));
    expect(Math.max(...dates)).toBeLessThan(OLDEST);
  });
});
