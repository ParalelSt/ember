import { describe, expect, it } from 'vitest';
import { barPosition, countInFrom, countInPlan, nextSlower, stageMeta, toolCells } from './tabStage';
import { buildTimeline } from './tabTimeline';
import type { ScoreInfo } from './tabScore';

const info: ScoreInfo = {
  tempo: 96,
  signature: null,
  key: 'D minor',
  tracks: [
    { index: 0, name: 'Rhythm guitar', instrument: 'Distortion guitar', tuning: 'Drop D', strings: 'D A D G B E', tab: true },
    { index: 1, name: '', instrument: 'Bass', tuning: '', strings: '', tab: true },
  ],
};

describe('stageMeta', () => {
  it('says the artist, the part shown and the speed', () => {
    expect(stageMeta('Coastline', info, 0, 1)).toBe('Coastline · Rhythm guitar · 100%');
    expect(stageMeta('Coastline', info, 0, 0.75)).toBe('Coastline · Rhythm guitar · 75%');
  });

  it('names a track without a name by its instrument', () => {
    expect(stageMeta('Coastline', info, 1, 1)).toBe('Coastline · Bass · 100%');
  });

  it('leaves out what is not known yet', () => {
    expect(stageMeta('Coastline', null, 0, 1)).toBe('Coastline · 100%');
    expect(stageMeta('', null, 0, 0.5)).toBe('50%');
  });
});

describe('nextSlower', () => {
  it('steps down the presets, then back to full speed', () => {
    const seen = [100];
    for (let i = 0; i < 7; i++) seen.push(nextSlower(seen[seen.length - 1]));
    expect(seen).toEqual([100, 90, 80, 75, 70, 60, 50, 100]);
  });

  it('a speed between presets goes to the preset under it; over full speed, to full speed', () => {
    expect(nextSlower(85)).toBe(80);
    expect(nextSlower(110)).toBe(100);
    expect(nextSlower(125)).toBe(100);
  });
});

describe('barPosition', () => {
  /** Four bars of 4/4 at 120: two seconds each. */
  const timeline = buildTimeline(
    [0, 1, 2, 3].map((i) => ({ start: i * 3840, end: (i + 1) * 3840, tempoChanges: [{ tick: i * 3840, tempo: 120 }], masterBar: { index: i } })),
  );

  it('is the bar playing, 1-based, of all of them', () => {
    expect(barPosition(timeline, 0)).toEqual({ bar: 1, total: 4 });
    expect(barPosition(timeline, 2500)).toEqual({ bar: 2, total: 4 });
    expect(barPosition(timeline, 7999)).toEqual({ bar: 4, total: 4 });
  });

  it('before the first bar it is bar 1', () => {
    expect(barPosition(timeline, -800)).toEqual({ bar: 1, total: 4 });
  });

  it('nothing while the bars are not known', () => {
    expect(barPosition(null, 0)).toBeNull();
    expect(barPosition({ bars: [], tempos: [] }, 0)).toBeNull();
  });
});

describe('toolCells', () => {
  const base = {
    speedPercent: 100,
    loopOn: false,
    loopLabel: null,
    metronomeOn: false,
    bpm: 96,
    countIn: 1 as const,
    offsetMs: 0,
    offsetText: '0.00 s',
  };

  it('five cells, each with its value, off when it does nothing', () => {
    expect(toolCells(base)).toEqual([
      { id: 'speed', name: 'Speed', value: '100%', on: false },
      { id: 'loop', name: 'Loop', value: 'Off', on: false },
      { id: 'click', name: 'Click', value: 'Off', on: false },
      { id: 'count', name: 'Count-in', value: '1 bar', on: true },
      { id: 'delay', name: 'Delay', value: '0.00 s', on: false },
    ]);
  });

  it('on and saying how, when set', () => {
    const cells = toolCells({ ...base, speedPercent: 75, loopOn: true, loopLabel: 'Bars 3–6', metronomeOn: true, bpm: 103.6, countIn: 2, offsetMs: 250, offsetText: '+0.25 s' });
    expect(cells.map((c) => [c.value, c.on])).toEqual([
      ['75%', true],
      ['Bars 3–6', true],
      ['104', true],
      ['2 bars', true],
      ['+0.25 s', true],
    ]);
  });

  it('a loop that is chosen but off says Off; count-in off says Off', () => {
    const cells = toolCells({ ...base, loopLabel: 'Bar 2', countIn: 0 });
    expect(cells[1]).toMatchObject({ value: 'Off', on: false });
    expect(cells[3]).toMatchObject({ value: 'Off', on: false });
  });
});

describe('countInPlan', () => {
  it('one bar of 4/4 at 120: four clicks half a second apart, the first accented', () => {
    const plan = countInPlan(1, { bpm: 120 });
    expect(plan.clicks).toEqual([
      { atSec: 0, accent: true },
      { atSec: 0.5, accent: false },
      { atSec: 1, accent: false },
      { atSec: 1.5, accent: false },
    ]);
    expect(plan.totalSec).toBe(2);
  });

  it('two bars of 3/4, slowed to half speed', () => {
    const plan = countInPlan(2, { bpm: 120, numerator: 3, denominator: 4, rate: 0.5 });
    expect(plan.clicks).toHaveLength(6);
    expect(plan.clicks.map((c) => c.accent)).toEqual([true, false, false, true, false, false]);
    expect(plan.clicks[1].atSec).toBe(1);
    expect(plan.totalSec).toBe(6);
  });

  it('eighth-note beats in 6/8', () => {
    const plan = countInPlan(1, { bpm: 120, numerator: 6, denominator: 8 });
    expect(plan.clicks).toHaveLength(6);
    expect(plan.clicks[1].atSec).toBe(0.25);
  });

  it('nothing to count when off or without a tempo', () => {
    expect(countInPlan(0, { bpm: 120 }).clicks).toEqual([]);
    expect(countInPlan(1, { bpm: null }).totalSec).toBe(0);
  });

  it('a stored choice reads back, anything else is one bar', () => {
    expect(countInFrom('0')).toBe(0);
    expect(countInFrom('2')).toBe(2);
    expect(countInFrom(null)).toBe(1);
    expect(countInFrom('7')).toBe(1);
  });
});
