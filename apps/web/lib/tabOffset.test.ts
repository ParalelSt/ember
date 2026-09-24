import { describe, expect, it } from 'vitest';
import {
  beatClockOf,
  beatMs,
  beatsToMs,
  formatOffset,
  msToBeats,
  nudgeSteps,
  offsetFromInput,
  offsetInUnit,
  sliderSpanSec,
} from './tabOffset';
import { MAX_OFFSET_MS } from './tabSync';

const FOUR_FOUR_120 = { bpm: 120, numerator: 4, denominator: 4 };

describe('a beat of the tab', () => {
  it('is a quarter note at the tab tempo in 4/4', () => {
    expect(beatMs(FOUR_FOUR_120)).toBe(500);
    expect(beatMs({ bpm: 96, numerator: 4, denominator: 4 })).toBe(625);
  });

  it('is the signature beat unit: an eighth in 6/8, a half in 2/2', () => {
    expect(beatMs({ bpm: 120, numerator: 6, denominator: 8 })).toBe(250);
    expect(beatMs({ bpm: 120, numerator: 2, denominator: 2 })).toBe(1000);
  });

  it('converts both ways', () => {
    expect(beatsToMs(8, FOUR_FOUR_120)).toBe(4000);
    expect(beatsToMs(-2.5, FOUR_FOUR_120)).toBe(-1250);
    expect(msToBeats(4000, FOUR_FOUR_120)).toBe(8);
    const odd = { bpm: 97, numerator: 7, denominator: 8 };
    expect(msToBeats(beatsToMs(13, odd), odd)).toBeCloseTo(13);
  });

  it('needs a tempo; a missing signature counts as 4/4', () => {
    expect(beatClockOf(null)).toBeNull();
    expect(beatClockOf(0)).toBeNull();
    expect(beatClockOf(140, null)).toEqual({ bpm: 140, numerator: 4, denominator: 4 });
    expect(beatClockOf(140, { numerator: 3, denominator: 4 })).toEqual({ bpm: 140, numerator: 3, denominator: 4 });
  });
});

describe('typing the nudge', () => {
  it('reads seconds, fine to 10 ms, with a sign or a comma', () => {
    expect(offsetFromInput('1.234', 'seconds', null)).toBe(1230);
    expect(offsetFromInput('+2', 'seconds', null)).toBe(2000);
    expect(offsetFromInput('-0,55', 'seconds', null)).toBe(-550);
    expect(offsetFromInput('-95', 'seconds', null)).toBe(-95_000);
  });

  it('reads beats through the tab tempo and signature', () => {
    expect(offsetFromInput('8', 'beats', FOUR_FOUR_120)).toBe(4000);
    expect(offsetFromInput('-1.5', 'beats', FOUR_FOUR_120)).toBe(-750);
    // 6/8 at 90: an eighth is 333.3 ms, three of them 1 s.
    expect(offsetFromInput('3', 'beats', { bpm: 90, numerator: 6, denominator: 8 })).toBe(1000);
  });

  it('refuses junk, and beats with no tempo', () => {
    expect(offsetFromInput('', 'seconds', null)).toBeNull();
    expect(offsetFromInput('soon', 'seconds', null)).toBeNull();
    expect(offsetFromInput('4', 'beats', null)).toBeNull();
  });

  it('is clamped to the half hour', () => {
    expect(offsetFromInput('99999', 'seconds', null)).toBe(MAX_OFFSET_MS);
  });
});

describe('showing the nudge', () => {
  it('in seconds or beats, trimmed to hundredths', () => {
    expect(offsetInUnit(1230, 'seconds', null)).toBe(1.23);
    expect(offsetInUnit(-4000, 'beats', FOUR_FOUR_120)).toBe(-8);
    expect(formatOffset(1230, 'seconds', null)).toBe('+1.23 s');
    expect(formatOffset(-4000, 'beats', FOUR_FOUR_120)).toBe('-8 beats');
    expect(formatOffset(500, 'beats', FOUR_FOUR_120)).toBe('+1 beat');
    expect(formatOffset(0, 'seconds', null)).toBe('0 s');
  });

  it('falls back to seconds when the tab has no tempo', () => {
    expect(formatOffset(1500, 'beats', null)).toBe('+1.5 s');
  });

  it('the slider reaches a minute, and further to show a big nudge', () => {
    expect(sliderSpanSec(0)).toBe(60);
    expect(sliderSpanSec(59_000)).toBe(60);
    expect(sliderSpanSec(-95_000)).toBe(120);
    expect(sliderSpanSec(MAX_OFFSET_MS * 2)).toBe(MAX_OFFSET_MS / 1000);
  });

  it('nudges by tenths and seconds, or by beats and bars', () => {
    expect(nudgeSteps('seconds', null).map((s) => s.ms)).toEqual([-1000, -100, 100, 1000]);
    expect(nudgeSteps('beats', { bpm: 120, numerator: 3, denominator: 4 }).map((s) => [s.label, s.ms])).toEqual([
      ['-1 bar', -1500],
      ['-1 beat', -500],
      ['+1 beat', 500],
      ['+1 bar', 1500],
    ]);
  });
});
