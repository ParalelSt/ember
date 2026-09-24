import { describe, expect, it } from 'vitest';
import {
  barAtMs,
  barStartsOf,
  bpmAtMs,
  buildTimeline,
  steadyBeats,
  tabBeats,
  tempoSteps,
  type MasterBarLookup,
} from './tabTimeline';

const Q = 960; // ticks per quarter
const BAR = 4 * Q;

/** AlphaTab's tick lookup for: two bars of 4/4 at 120 ("Intro"), a bar of
 *  3/4 still at 120, then "Verse" at 60 bpm for two bars of 4/4. */
function lookup(): MasterBarLookup[] {
  const bars: MasterBarLookup[] = [];
  let tick = 0;
  const add = (index: number, num: number, tempo: number, section?: string, changeAt?: number) => {
    const len = num * Q;
    bars.push({
      start: tick,
      end: tick + len,
      tempoChanges: [{ tick: changeAt ?? tick, tempo }],
      masterBar: { index, timeSignatureNumerator: num, timeSignatureDenominator: 4, section: section ? { text: section } : null },
    });
    tick += len;
  };
  add(0, 4, 120, 'Intro');
  add(1, 4, 120);
  add(2, 3, 120);
  add(3, 4, 60, 'Verse');
  add(4, 4, 60);
  return bars;
}

describe('the tab timeline', () => {
  it('reads bars, signatures, sections and times off the tick lookup', () => {
    const t = buildTimeline(lookup());
    expect(t.bars.map((b) => [b.index, b.startMs, b.endMs, `${b.numerator}/${b.denominator}`, b.section])).toEqual([
      [0, 0, 2000, '4/4', 'Intro'],
      [1, 2000, 4000, '4/4', null],
      [2, 4000, 5500, '3/4', null],
      [3, 5500, 9500, '4/4', 'Verse'],
      [4, 9500, 13500, '4/4', null],
    ]);
    expect(t.tempos[0]).toEqual({ tick: 0, bpm: 120 });
    expect(t.tempos).toContainEqual({ tick: 11 * Q, bpm: 60 });
  });

  it('knows the tempo at any point, and every tempo the tab plays at', () => {
    const t = buildTimeline(lookup());
    expect(bpmAtMs(t, 0)).toBe(120);
    expect(bpmAtMs(t, 5499)).toBe(120);
    expect(bpmAtMs(t, 5500)).toBe(60);
    expect(tempoSteps(t)).toEqual([120, 60]);
    expect(bpmAtMs(buildTimeline([]), 10)).toBeNull();
  });

  it('finds the bar at a time, and each bar start by index', () => {
    const t = buildTimeline(lookup());
    expect(barAtMs(t, 4500)?.index).toBe(2);
    expect(barAtMs(t, -5)).toBeNull();
    expect(barStartsOf(t)).toEqual([0, 2000, 4000, 5500, 9500]);
  });

  it('a bar played twice (a repeat) keeps its first start', () => {
    const bars = lookup();
    bars.push({ ...bars[1], start: 19 * Q, end: 23 * Q });
    const t = buildTimeline(bars);
    expect(t.bars.at(-1)?.index).toBe(1);
    expect(barStartsOf(t)[1]).toBe(2000);
  });

  it('falls back to 4/4 and the next bar start when AlphaTab leaves them out', () => {
    const t = buildTimeline([{ start: 0, tempoChanges: [{ tick: 0, tempo: 60 }] }, { start: BAR }]);
    expect(t.bars[0]).toMatchObject({ index: 0, numerator: 4, denominator: 4, endMs: 4000 });
    expect(t.bars[1]).toMatchObject({ index: 1, startMs: 4000, endMs: 8000 });
  });
});

describe('the metronome beats of the tab', () => {
  it('clicks each beat, accenting the first of a bar, through the tempo change', () => {
    const t = buildTimeline(lookup());
    const beats = tabBeats(t, 0, 13_500);
    // 4 + 4 beats at 500 ms, 3 more, then 8 at a second each.
    expect(beats.map((b) => b.at)).toEqual([
      0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6500, 7500, 8500, 9500, 10500, 11500, 12500,
    ]);
    expect(beats.filter((b) => b.accent).map((b) => b.at)).toEqual([0, 2000, 4000, 5500, 9500]);
  });

  it('only the beats in the window asked for', () => {
    const t = buildTimeline(lookup());
    expect(tabBeats(t, 5200, 7000).map((b) => b.at)).toEqual([5500, 6500]);
    expect(tabBeats(t, 7000, 7000)).toEqual([]);
  });

  it('counts eighths in 6/8', () => {
    const t = buildTimeline([
      { start: 0, end: 3 * Q, tempoChanges: [{ tick: 0, tempo: 120 }], masterBar: { index: 0, timeSignatureNumerator: 6, timeSignatureDenominator: 8 } },
    ]);
    expect(tabBeats(t, 0, 2000).map((b) => b.at)).toEqual([0, 250, 500, 750, 1000, 1250]);
  });

  it('a pickup bar clicks its beats without an accent', () => {
    const t = buildTimeline([
      { start: 0, end: Q, tempoChanges: [{ tick: 0, tempo: 120 }], masterBar: { index: 0, timeSignatureNumerator: 4, timeSignatureDenominator: 4 } },
      { start: Q, end: Q + BAR, masterBar: { index: 1, timeSignatureNumerator: 4, timeSignatureDenominator: 4 } },
    ]);
    const beats = tabBeats(t, 0, 3000);
    expect(beats.map((b) => [b.at, b.accent])).toEqual([
      [0, false],
      [500, true],
      [1000, false],
      [1500, false],
      [2000, false],
    ]);
  });
});

describe('the metronome at a tempo of the listener', () => {
  it('is steady from where the tab starts, accenting each bar', () => {
    const beats = steadyBeats(1.0, 120, 4, 0, 4.0);
    expect(beats.map((b) => b.at)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
    expect(beats.filter((b) => b.accent).map((b) => b.at)).toEqual([1, 3]);
  });

  it('never before the song starts, never outside the window', () => {
    expect(steadyBeats(0.25, 60, 4, -3, 1.3).map((b) => b.at)).toEqual([0.25, 1.25]);
    expect(steadyBeats(0, 60, 4, 2, 2)).toEqual([]);
    expect(steadyBeats(0, 0, 4, 0, 10)).toEqual([]);
  });
});
