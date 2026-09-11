import { describe, expect, it } from 'vitest';
import { chooseDuration } from './chooseDuration';

// Ported from tests/duration.test.mjs (kept there until deslop step 9).

describe('chooseDuration', () => {
  it('the reported bug: engine says nothing, catalog wins', () => {
    expect(chooseDuration(213, null)).toBe(213);
    expect(chooseDuration(213, undefined)).toBe(213);
    expect(chooseDuration(213, 0)).toBe(213);
  });

  it('a song never inherits the previous song\'s length', () => {
    // Song A was 300s. Song B is 180s and its engine reports nothing.
    // The answer must be B's length, never A's.
    expect(chooseDuration(180, null)).toBe(180);
  });

  it('a wildly wrong engine figure is rejected', () => {
    expect(chooseDuration(200, 4000)).toBe(200);
    expect(chooseDuration(200, 12)).toBe(200);
  });

  it('an engine figure that agrees is preferred (more precise for seeking)', () => {
    expect(chooseDuration(200, 203)).toBe(203);
    expect(chooseDuration(200, 197.5)).toBe(197.5);
  });

  it('exactly at the agreement edge still counts as agreeing', () => {
    expect(chooseDuration(200, 220)).toBe(220);
    expect(chooseDuration(200, 180)).toBe(180);
  });

  it('no catalog length falls back to the engine', () => {
    expect(chooseDuration(0, 245)).toBe(245);
  });

  it('nonsense from either side yields 0, not NaN or Infinity', () => {
    for (const bad of [NaN, Infinity, -5, null, undefined]) {
      expect(chooseDuration(bad as number, bad as number)).toBe(0);
    }
    // A day-long "song" is nonsense.
    expect(chooseDuration(0, 999999)).toBe(0);
  });
});
