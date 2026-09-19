import { afterEach, describe, expect, it } from 'vitest';
import {
  beatToSongSec,
  clampOffset,
  estimateSongSec,
  followScroll,
  isJump,
  loadLocalOffsetMs,
  MAX_OFFSET_MS,
  saveLocalOffsetMs,
  songToTabMs,
  tabMsToSongSec,
  tempoMap,
  tickToMs,
  type TickLookup,
} from './tabSync';

describe('song time and the tab clock', () => {
  it('feeds the song position in ms, shifted by the offset', () => {
    expect(songToTabMs(10, 0)).toBe(10_000);
    // The tab runs 1.5 s ahead: at 10 s into the song the cursor is at 11.5 s.
    expect(songToTabMs(10, 1500)).toBe(11_500);
    expect(songToTabMs(10, -2000)).toBe(8000);
  });

  it('never feeds a negative time (a negative offset before it takes hold)', () => {
    expect(songToTabMs(1, -3000)).toBe(0);
  });

  it('maps a point of the tab back to the song, undoing the offset', () => {
    expect(tabMsToSongSec(11_500, 1500)).toBe(10);
    expect(tabMsToSongSec(8000, -2000)).toBe(10);
    expect(tabMsToSongSec(500, 1500)).toBe(0);
    for (const offset of [-4000, 0, 2500]) expect(tabMsToSongSec(songToTabMs(42, offset), offset)).toBeCloseTo(42);
  });

  it('clamps the nudge to +-10 s in 100 ms steps', () => {
    expect(clampOffset(1234)).toBe(1200);
    expect(clampOffset(99_000)).toBe(MAX_OFFSET_MS);
    expect(clampOffset(-99_000)).toBe(-MAX_OFFSET_MS);
    expect(clampOffset(Number.NaN)).toBe(0);
  });
});

describe('ticks to milliseconds', () => {
  it('reads the tempo map out of the tick lookup, sorted and deduplicated', () => {
    const map = tempoMap([
      { tempoChanges: [{ tick: 0, tempo: 96 }] },
      { tempoChanges: [] },
      { tempoChanges: [{ tick: 7680, tempo: 120 }, { tick: 7680, tempo: 120 }] },
    ]);
    expect(map).toEqual([
      { tick: 0, bpm: 96 },
      { tick: 7680, bpm: 120 },
    ]);
  });

  it('a quarter note at 96 bpm is 625 ms (960 ticks per quarter)', () => {
    const map = [{ tick: 0, bpm: 96 }];
    expect(tickToMs(map, 960)).toBeCloseTo(625);
    // Bar 2 of 4/4 starts 4 quarters in: 2.5 s.
    expect(tickToMs(map, 3840)).toBeCloseTo(2500);
  });

  it('walks tempo changes: 2 bars at 96 then 120 bpm', () => {
    const map = [
      { tick: 0, bpm: 96 },
      { tick: 7680, bpm: 120 },
    ];
    // 2 bars at 96 = 5 s, then one quarter at 120 = 0.5 s.
    expect(tickToMs(map, 7680 + 960)).toBeCloseTo(5500);
  });

  it('is 120 bpm with no tempo at all, like AlphaTab', () => {
    expect(tickToMs([], 960)).toBeCloseTo(500);
  });
});

describe('click a beat to seek', () => {
  const bar2 = { id: 'mb2' };
  const lookup: TickLookup = {
    masterBars: [{ tempoChanges: [{ tick: 0, tempo: 96 }] }],
    getMasterBarStart: (mb) => (mb === bar2 ? 3840 : 0),
    getRelativeBeatPlaybackRange: () => ({ startTick: 1920 }),
  };
  const beat = { playbackStart: 999, voice: { bar: { masterBar: bar2 } } };

  it('seeks the song to where the beat sounds', () => {
    // Bar 2 (2.5 s) plus half a bar (1.25 s).
    expect(beatToSongSec(lookup, beat, 0)).toBeCloseTo(3.75);
  });

  it('takes the offset back out: a tab running ahead lands earlier in the song', () => {
    expect(beatToSongSec(lookup, beat, 1000)).toBeCloseTo(2.75);
    expect(beatToSongSec(lookup, beat, -1000)).toBeCloseTo(4.75);
  });

  it('falls back to the beat playbackStart without a relative range', () => {
    const plain: TickLookup = { ...lookup, getRelativeBeatPlaybackRange: undefined };
    expect(beatToSongSec(plain, { ...beat, playbackStart: 960 }, 0)).toBeCloseTo(3.125);
  });
});

describe('the playhead between player reports', () => {
  it('runs on by the wall clock while playing', () => {
    expect(estimateSongSec({ sec: 10, at: 1000 }, 1250, true)).toBeCloseTo(10.25);
  });

  it('holds still while paused', () => {
    expect(estimateSongSec({ sec: 10, at: 1000 }, 5000, false)).toBe(10);
  });

  it('stops running ahead after a second without a report (a stall)', () => {
    expect(estimateSongSec({ sec: 10, at: 1000 }, 9000, true)).toBeCloseTo(11);
  });
});

describe('telling a seek from playback', () => {
  it('the first position fed is a jump: the cursor is placed, not slid there', () => {
    expect(isJump(null, 30_000, 1000, true)).toBe(true);
  });

  it('steady playback is not a jump', () => {
    expect(isJump({ ms: 30_000, at: 1000 }, 30_050, 1050, true)).toBe(false);
    // The player's report landing a little off the wall-clock estimate.
    expect(isJump({ ms: 30_000, at: 1000 }, 29_900, 1050, true)).toBe(false);
  });

  it('holding still while paused is not a jump', () => {
    expect(isJump({ ms: 30_000, at: 1000 }, 30_000, 4000, false)).toBe(false);
  });

  it('a seek a beat or two ahead is a jump, playing or paused', () => {
    // 0.7 s ahead: the case AlphaTab animated towards instead of jumping.
    expect(isJump({ ms: 30_000, at: 1000 }, 30_750, 1050, true)).toBe(true);
    expect(isJump({ ms: 30_000, at: 1000 }, 30_700, 1050, false)).toBe(true);
  });

  it('a seek back is a jump', () => {
    expect(isJump({ ms: 30_000, at: 1000 }, 27_000, 1050, true)).toBe(true);
  });

  it('a feed that stopped for a while (a background tab) resumes with a jump', () => {
    expect(isJump({ ms: 30_000, at: 1000 }, 42_000, 13_000, true)).toBe(true);
  });
});

describe('follow-scroll', () => {
  const view = { scrollTop: 0, scrollLeft: 0, width: 1000, height: 900, topInset: 60 };

  it('vertical: leaves the page alone while the bar is in the upper two thirds', () => {
    expect(followScroll('vertical', { x: 0, y: 200, w: 300, h: 120 }, view)).toBeNull();
  });

  it('vertical: a bar on a row further down is brought to the upper third, below the toolbar', () => {
    const t = followScroll('vertical', { x: 0, y: 900, w: 300, h: 120 }, view);
    expect(t).toEqual({ top: Math.round(900 - 60 - 840 / 3 + 60) });
    expect(t?.left).toBeUndefined();
  });

  it('vertical: a seek back above the view scrolls up', () => {
    const t = followScroll('vertical', { x: 0, y: 100, w: 300, h: 120 }, { ...view, scrollTop: 2000 });
    expect(t?.top).toBe(0);
  });

  it('horizontal: brings the playing beat back to a third of the way in, and only scrolls sideways', () => {
    const t = followScroll('horizontal', { x: 1500, y: 900, w: 300, h: 120 }, view);
    expect(t).toEqual({ left: Math.round(1500 - 1000 / 3) });
    expect(t?.top).toBeUndefined();
  });

  it('paused: a line anywhere on screen is left where it is, a click there does not move the page', () => {
    // Below the upper two thirds, but visible: playing would scroll, paused does not.
    expect(followScroll('vertical', { x: 0, y: 700, w: 300, h: 120 }, view, undefined, { hiddenOnly: true })).toBeNull();
    expect(followScroll('horizontal', { x: 900, y: 0, w: 200, h: 120 }, view, { x: 900, y: 0, w: 1, h: 120 }, { hiddenOnly: true })).toBeNull();
  });

  it('paused: a line off screen (a refresh, the player bar) is brought into view as usual', () => {
    expect(followScroll('vertical', { x: 0, y: 1500, w: 300, h: 120 }, view, undefined, { hiddenOnly: true })).toEqual(
      followScroll('vertical', { x: 0, y: 1500, w: 300, h: 120 }, view),
    );
    // Hidden under the sticky toolbar counts as off screen.
    expect(followScroll('vertical', { x: 0, y: 500, w: 300, h: 120 }, { ...view, scrollTop: 480 }, undefined, { hiddenOnly: true })).not.toBeNull();
    expect(followScroll('horizontal', { x: 1500, y: 0, w: 200, h: 120 }, view, { x: 1500, y: 0, w: 1, h: 120 }, { hiddenOnly: true })).not.toBeNull();
  });

  it('horizontal: no scroll while the beat sits inside the band', () => {
    expect(followScroll('horizontal', { x: 300, y: 0, w: 200, h: 120 }, view)).toBeNull();
  });

  it('horizontal follows the beat, not the bar: a wide bar on a phone still scrolls mid-bar', () => {
    const phone = { ...view, width: 342 };
    const bar = { x: 100, y: 0, w: 230, h: 120 };
    // Early in the bar: in view, stay.
    expect(followScroll('horizontal', bar, phone, { x: 120, y: 0, w: 3, h: 120 })).toBeNull();
    // Late in the same bar the beat nears the edge: scroll to keep it a third in.
    expect(followScroll('horizontal', bar, phone, { x: 300, y: 0, w: 3, h: 120 })).toEqual({ left: 300 - 114 });
  });

  it('switching modes switches the axis for the same bar', () => {
    const bar = { x: 1500, y: 1500, w: 300, h: 120 };
    expect(Object.keys(followScroll('vertical', bar, view) ?? {})).toEqual(['top']);
    expect(Object.keys(followScroll('horizontal', bar, view) ?? {})).toEqual(['left']);
  });
});

describe('the nudge kept on this device', () => {
  afterEach(() => window.localStorage.clear());

  it('is stored in seconds under the old viewer key, read back in ms', () => {
    saveLocalOffsetMs('tab1', 1500);
    expect(window.localStorage.getItem('ember.tab.offset.tab1')).toBe('1.5');
    expect(loadLocalOffsetMs('tab1')).toBe(1500);
  });

  it('reads a nudge the old viewer wrote', () => {
    window.localStorage.setItem('ember.tab.offset.generated:upload:x', '-2.3');
    expect(loadLocalOffsetMs('generated:upload:x')).toBe(-2300);
  });

  it('is null when there is none, or it was cleared', () => {
    expect(loadLocalOffsetMs('nothing')).toBeNull();
    saveLocalOffsetMs('tab1', 500);
    saveLocalOffsetMs('tab1', null);
    expect(loadLocalOffsetMs('tab1')).toBeNull();
  });
});
