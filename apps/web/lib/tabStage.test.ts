import { describe, expect, it } from 'vitest';
import { barPosition, nextSlower, stageMeta } from './tabStage';
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
