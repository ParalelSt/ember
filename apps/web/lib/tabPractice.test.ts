import { describe, expect, it } from 'vitest';
import {
  barCount,
  bpmAtRate,
  clampRate,
  loopJump,
  loopSpanMs,
  normalizeRange,
  pickBar,
  rangeLabel,
  rateFromBpm,
  rateFromPercent,
  sectionRanges,
} from './tabPractice';
import { buildTimeline, type MasterBarLookup } from './tabTimeline';

const Q = 960;

/** Eight bars of 4/4 at 120 (2 s a bar): "Intro" at 0, "Verse" at 2,
 *  "Chorus" at 6. With `repeat`, bars 2-3 are played twice. */
function timeline(repeat = false) {
  const order = repeat ? [0, 1, 2, 3, 2, 3, 4, 5, 6, 7] : [0, 1, 2, 3, 4, 5, 6, 7];
  const names: Record<number, string> = { 0: 'Intro', 2: 'Verse', 6: 'Chorus' };
  const bars: MasterBarLookup[] = order.map((index, i) => ({
    start: i * 4 * Q,
    end: (i + 1) * 4 * Q,
    tempoChanges: [{ tick: i * 4 * Q, tempo: 120 }],
    masterBar: { index, timeSignatureNumerator: 4, timeSignatureDenominator: 4, section: names[index] ? { text: names[index] } : null },
  }));
  return buildTimeline(bars);
}

describe('practice speed', () => {
  it('in percent, clamped to 50%..125%', () => {
    expect(rateFromPercent(75)).toBe(0.75);
    expect(rateFromPercent(10)).toBe(0.5);
    expect(rateFromPercent(300)).toBe(1.25);
    expect(clampRate(Number.NaN)).toBe(1);
    expect(clampRate(0)).toBe(1);
  });

  it('by tempo: the speed that plays the tab at a chosen bpm', () => {
    expect(rateFromBpm(90, 120)).toBe(0.75);
    expect(rateFromBpm(60, 120)).toBe(0.5);
    expect(rateFromBpm(30, 120)).toBe(0.5);
    expect(rateFromBpm(90, null)).toBeNull();
    expect(rateFromBpm(0, 120)).toBeNull();
    expect(bpmAtRate(120, 0.75)).toBe(90);
    expect(bpmAtRate(null, 0.75)).toBeNull();
  });
});

describe('the loop', () => {
  it('lists the sections the markers make, each up to the next', () => {
    expect(sectionRanges(timeline())).toEqual([
      { name: 'Intro', start: 0, end: 1 },
      { name: 'Verse', start: 2, end: 5 },
      { name: 'Chorus', start: 6, end: 7 },
    ]);
    // A section inside a repeat is listed once.
    expect(sectionRanges(timeline(true)).map((s) => s.name)).toEqual(['Intro', 'Verse', 'Chorus']);
    expect(barCount(timeline(true))).toBe(8);
  });

  it('puts a range in order and inside the score', () => {
    const t = timeline();
    expect(normalizeRange({ start: 5, end: 2 }, t)).toEqual({ start: 2, end: 5 });
    expect(normalizeRange({ start: -3, end: 40 }, t)).toEqual({ start: 0, end: 7 });
    expect(normalizeRange(null, t)).toBeNull();
    expect(normalizeRange({ start: 1, end: 2 }, buildTimeline([]))).toBeNull();
  });

  it('runs on the tab clock from the first bar to the end of the last', () => {
    expect(loopSpanMs(timeline(), { start: 2, end: 3 })).toEqual({ startMs: 4000, endMs: 8000 });
    expect(loopSpanMs(timeline(), { start: 6, end: 6 })).toEqual({ startMs: 12_000, endMs: 14_000 });
  });

  it('inside a repeat, loops the first pass', () => {
    expect(loopSpanMs(timeline(true), { start: 2, end: 3 })).toEqual({ startMs: 4000, endMs: 8000 });
    // Bars 3 to 4 are 3 (first pass) through 4 (after the repeat).
    expect(loopSpanMs(timeline(true), { start: 3, end: 4 })).toEqual({ startMs: 6000, endMs: 14_000 });
  });

  it('jumps back when the playhead runs over the end from inside', () => {
    const span = { startSec: 5, endSec: 10 };
    expect(loopJump(9.98, 10.01, span)).toBe(5);
    expect(loopJump(4.7, 10.1, span)).toBeNull(); // a seek, not running on
    expect(loopJump(9.5, 9.9, span)).toBeNull(); // still inside
    expect(loopJump(12, 12.05, span)).toBeNull(); // the listener went past it
    expect(loopJump(4.6, 4.65, span)).toBeNull(); // before it
    expect(loopJump(null, 10.2, span)).toBeNull();
    expect(loopJump(9.9, 10.2, { startSec: 10, endSec: 10 })).toBeNull();
  });

  it('two clicks make a range, either way round', () => {
    const first = pickBar(null, 6);
    expect(first).toEqual({ picking: 6, range: null });
    expect(pickBar(first.picking, 2)).toEqual({ picking: null, range: { start: 2, end: 6 } });
    expect(pickBar(3, 3)).toEqual({ picking: null, range: { start: 3, end: 3 } });
  });

  it('says the range as a listener counts', () => {
    expect(rangeLabel({ start: 4, end: 11 })).toBe('Bars 5–12');
    expect(rangeLabel({ start: 2, end: 2 })).toBe('Bar 3');
  });
});
