import { afterEach, describe, expect, it } from 'vitest';
import {
  barStartsMs,
  beatToSongSec,
  clampOffset,
  isLinedUp,
  readTiming,
  songSecToTabMs,
  syncPoints,
  tabMsToSongSecAligned,
  type TabTiming,
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

  it('keeps the nudge in 10 ms steps, far past the old 10 s limit', () => {
    expect(clampOffset(1234)).toBe(1230);
    expect(clampOffset(1236)).toBe(1240);
    expect(clampOffset(99_000)).toBe(99_000);
    expect(clampOffset(-245_500)).toBe(-245_500);
    expect(MAX_OFFSET_MS).toBe(30 * 60 * 1000);
    expect(clampOffset(99_000_000)).toBe(MAX_OFFSET_MS);
    expect(clampOffset(-99_000_000)).toBe(-MAX_OFFSET_MS);
    expect(clampOffset(Number.NaN)).toBe(0);
    expect(Object.is(clampOffset(-1), 0)).toBe(true);
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

describe('a tab lined up with the recording (piecewise over bar anchors)', () => {
  // The tab: 4/4 at 100 bpm, 2.4 s a bar on its own clock.
  const barTab = Array.from({ length: 8 }, (_, i) => i * 2400);
  // The recording: bar 1 at 1.35 s, bars getting shorter (it speeds up):
  // 2.5 s, 2.4 s, 2.3 s ...
  const barSong = [1350];
  for (let i = 1; i < 8; i++) barSong.push(barSong[i - 1] + 2500 - (i - 1) * 100);
  const timing: TabTiming = { offsetMs: 1350, bpm: 98, confidence: 0.9, bars: barSong.map((ms, bar) => ({ bar, ms })) };
  const points = syncPoints(timing, barTab);

  it('puts every bar start where the recording plays it', () => {
    barSong.forEach((ms, bar) => expect(songSecToTabMs(ms / 1000, points, 0)).toBeCloseTo(barTab[bar], 6));
  });

  it('is linear inside a bar that is longer or shorter than the tab’s', () => {
    // Halfway through bar 2 of the recording (2.4 s long) is halfway through
    // the tab's bar 2.
    expect(songSecToTabMs((barSong[1] + 1200) / 1000, points, 0)).toBeCloseTo(2400 + 1200, 6);
    // A quarter into bar 4 (2.2 s long).
    expect(songSecToTabMs((barSong[3] + 550) / 1000, points, 0)).toBeCloseTo(7200 + 600, 6);
  });

  it('runs back to the song exactly (the inverse), with and without the nudge', () => {
    for (const nudge of [0, 700, -1300]) {
      for (const sec of [1.4, 2.0, 5.55, 9.99, 14.2, 20.0]) {
        // Before the tab's top the clock holds at 0: no inverse there.
        if (sec * 1000 + nudge < 1350) continue;
        const tab = songSecToTabMs(sec, points, nudge);
        expect(tabMsToSongSecAligned(tab, points, nudge)).toBeCloseTo(sec, 6);
      }
    }
  });

  it('applies the nudge on top: a positive nudge runs the tab ahead', () => {
    // +500 ms: the song at 1.35 s reads as 1.85 s, half a second (at the
    // first bar's 2.5 s against the tab's 2.4 s) into the tab.
    expect(songSecToTabMs(1.35, points, 500)).toBeCloseTo(500 * (2400 / 2500), 6);
    expect(songSecToTabMs(1.35, points, -500)).toBe(0);
    // A clicked beat at the tab's bar 3 sounds at the recording's bar 3,
    // earlier by the nudge.
    expect(tabMsToSongSecAligned(4800, points, 500)).toBeCloseTo((barSong[2] - 500) / 1000, 6);
  });

  it('carries on at the edge bars’ pace before the first and past the last anchor', () => {
    // Before bar 1: the first bar's slope (2400 per 2500).
    expect(songSecToTabMs(0.35, points, 0)).toBe(0);
    expect(tabMsToSongSecAligned(-960, points, 0)).toBeCloseTo((1350 - 1000) / 1000, 6);
    // Past the last bar (2.0 s long on the recording, 2.4 s on the tab).
    const last = barSong[7];
    expect(songSecToTabMs((last + 1000) / 1000, points, 0)).toBeCloseTo(barTab[7] + 1000 * (2400 / 1900), 6);
  });

  it('takes only anchors that move forward on both clocks', () => {
    const messy: TabTiming = { ...timing, bars: [{ bar: 0, ms: 1000 }, { bar: 1, ms: 900 }, { bar: 2, ms: 5800 }, { bar: 99, ms: 9000 }] };
    expect(syncPoints(messy, barTab)).toEqual([
      { song: 1000, tab: 0 },
      { song: 5800, tab: 4800 },
    ]);
  });

  it('without bar anchors, the tab’s first bar sits at offset_ms (slope 1)', () => {
    const plain = syncPoints({ ...timing, bars: [] }, barTab);
    expect(plain).toEqual([{ song: 1350, tab: 0 }]);
    expect(songSecToTabMs(11.35, plain, 0)).toBeCloseTo(10_000, 6);
    expect(songSecToTabMs(11.35, plain, 250)).toBeCloseTo(10_250, 6);
    expect(tabMsToSongSecAligned(10_000, plain, 250)).toBeCloseTo(11.1, 6);
  });

  it('with no timing, it is the plain path exactly', () => {
    expect(syncPoints(null, barTab)).toEqual([]);
    expect(songSecToTabMs(10, [], 1500)).toBe(songToTabMs(10, 1500));
    expect(tabMsToSongSecAligned(4000, [], 1000)).toBe(tabMsToSongSec(4000, 1000));
  });

  it('seeks a clicked beat through the anchors', () => {
    const lookup: TickLookup = {
      masterBars: [{ tempoChanges: [{ tick: 0, tempo: 100 }] }],
      getMasterBarStart: () => 3840 * 2,
      getRelativeBeatPlaybackRange: () => ({ startTick: 1920 }),
    };
    const beat = { playbackStart: 0, voice: { bar: { masterBar: {} } } };
    // Bar 3, halfway: the recording's bar 3 is 2.3 s long.
    expect(beatToSongSec(lookup, beat, 0, points)).toBeCloseTo((barSong[2] + 1150) / 1000, 6);
    expect(beatToSongSec(lookup, beat, 0)).toBeCloseTo(6.0, 6);
  });

  it('reads bar starts from the tick lookup, through tempo changes', () => {
    const bars = [
      { start: 0, masterBar: { index: 0 }, tempoChanges: [{ tick: 0, tempo: 100 }] },
      { start: 3840, masterBar: { index: 1 }, tempoChanges: [{ tick: 3840, tempo: 120 }] },
      { start: 7680, masterBar: { index: 2 } },
      // A repeat plays bar 1 again: its first start is kept.
      { start: 11520, masterBar: { index: 1 } },
    ];
    expect(barStartsMs(bars)).toEqual([0, 2400, 4400]);
  });

  it('reads timing off the row, and knows when it is lined up', () => {
    const t = readTiming({ offset_ms: 1350, bpm: 97.4, confidence: 0.81, bars: [{ bar: 0, ms: 1350 }, { bar: 'x', ms: 2 }, { bar: 1, ms: 3800 }] });
    expect(t).toEqual({ offsetMs: 1350, bpm: 97.4, confidence: 0.81, bars: [{ bar: 0, ms: 1350 }, { bar: 1, ms: 3800 }] });
    expect(isLinedUp(t)).toBe(true);
    expect(isLinedUp({ ...t!, confidence: 0.3 })).toBe(false);
    expect(isLinedUp(null)).toBe(false);
    expect(readTiming(null)).toBeNull();
    expect(readTiming({ bpm: 90 })).toBeNull();
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
