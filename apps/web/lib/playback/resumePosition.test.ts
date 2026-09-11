import { describe, expect, it } from 'vitest';
import { resumeStartAt } from './resumePosition';

describe('resumeStartAt', () => {
  it('an explicit requested position wins over everything else', () => {
    expect(resumeStartAt({
      trackId: 'a', positionOwnerId: 'b', storedPosition: 50, requested: 12,
    })).toBe(12);
  });

  it('a negative requested position clamps to 0', () => {
    expect(resumeStartAt({
      trackId: 'a', positionOwnerId: 'a', storedPosition: 50, requested: -5,
    })).toBe(0);
  });

  it('a requested position of 0 is honored, not treated as "decide instead"', () => {
    expect(resumeStartAt({
      trackId: 'a', positionOwnerId: 'a', storedPosition: 50, requested: 0,
    })).toBe(0);
  });

  it('no owner recorded starts at 0', () => {
    expect(resumeStartAt({
      trackId: 'a', positionOwnerId: null, storedPosition: 50,
    })).toBe(0);
    expect(resumeStartAt({
      trackId: 'a', positionOwnerId: undefined, storedPosition: 50,
    })).toBe(0);
  });

  it('the stored position belongs to a different track: never hand it over', () => {
    expect(resumeStartAt({
      trackId: 'new-track', positionOwnerId: 'old-track', storedPosition: 120,
    })).toBe(0);
  });

  it('the stored position belongs to this track: resume there', () => {
    expect(resumeStartAt({
      trackId: 'a', positionOwnerId: 'a', storedPosition: 42,
    })).toBe(42);
  });

  it('a nonsense stored position (NaN, negative) is rejected, not handed to the player', () => {
    expect(resumeStartAt({
      trackId: 'a', positionOwnerId: 'a', storedPosition: NaN,
    })).toBe(0);
    expect(resumeStartAt({
      trackId: 'a', positionOwnerId: 'a', storedPosition: -10,
    })).toBe(0);
  });
});
