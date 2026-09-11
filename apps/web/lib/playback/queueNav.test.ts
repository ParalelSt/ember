import { describe, expect, it } from 'vitest';
import { isUnavailable, nextIndex, nextPlayable, prevIndex, wrapPoint, type QueueNavState } from './queueNav';

/** A queue of `n` placeholder entries; only the length is read. */
function q(n: number) {
  return { length: n };
}

function state(partial: Partial<QueueNavState> = {}): QueueNavState {
  return {
    queue: q(5),
    index: 0,
    loopMode: 'off',
    context: null,
    baseCount: 0,
    ...partial,
  };
}

describe('wrapPoint', () => {
  it('wraps a playlist at the end of the playlist, not the radio tail', () => {
    // 4 curated tracks, radio appended 6 more.
    const s = state({
      queue: q(10),
      baseCount: 4,
      context: { type: 'playlist', playlistId: 'p1', playlistName: 'Mix' },
    });
    expect(wrapPoint(s)).toBe(4);
  });

  it('wraps every other context around the whole queue', () => {
    expect(wrapPoint(state({ queue: q(7), baseCount: 1, context: { type: 'single' } }))).toBe(7);
    expect(wrapPoint(state({ queue: q(7), baseCount: 1, context: { type: 'radio' } }))).toBe(7);
    expect(wrapPoint(state({ queue: q(7), baseCount: 1, context: { type: 'search' } }))).toBe(7);
    expect(wrapPoint(state({ queue: q(7), baseCount: 1, context: null }))).toBe(7);
  });

  it('falls back to the queue length when a playlist has no recorded base size', () => {
    const s = state({ queue: q(3), baseCount: 0, context: { type: 'playlist', playlistId: 'p1', playlistName: 'Mix' } });
    expect(wrapPoint(s)).toBe(3);
  });

  it('never points past the end of a shortened queue', () => {
    const s = state({ queue: q(2), baseCount: 9, context: { type: 'playlist', playlistId: 'p1', playlistName: 'Mix' } });
    expect(wrapPoint(s)).toBe(2);
  });
});

describe('nextIndex', () => {
  it('advances inside the queue', () => {
    expect(nextIndex(state({ queue: q(5), index: 2 }))).toEqual({ index: 3 });
  });

  it('returns null at the end with loop off, so the caller can start radio', () => {
    expect(nextIndex(state({ queue: q(5), index: 4 }))).toBeNull();
  });

  it('wraps the whole queue at the end with loop-all', () => {
    expect(nextIndex(state({ queue: q(5), index: 4, loopMode: 'all' }))).toEqual({ wrap: true, index: 0 });
  });

  it('wraps a playlist at the playlist end even though radio extended the queue', () => {
    const s = state({
      queue: q(10),
      index: 3,
      loopMode: 'all',
      baseCount: 4,
      context: { type: 'playlist', playlistId: 'p1', playlistName: 'Mix' },
    });
    expect(nextIndex(s)).toEqual({ wrap: true, index: 0 });
  });

  it('wraps back from the radio tail of a looping playlist', () => {
    const s = state({
      queue: q(10),
      index: 7,
      loopMode: 'all',
      baseCount: 4,
      context: { type: 'playlist', playlistId: 'p1', playlistName: 'Mix' },
    });
    expect(nextIndex(s)).toEqual({ wrap: true, index: 0 });
  });

  it('still advances mid-playlist with loop-all on', () => {
    const s = state({
      queue: q(10),
      index: 1,
      loopMode: 'all',
      baseCount: 4,
      context: { type: 'playlist', playlistId: 'p1', playlistName: 'Mix' },
    });
    expect(nextIndex(s)).toEqual({ index: 2 });
  });

  it('treats a single-track queue under loop-all as a wrap, not a dead end', () => {
    expect(nextIndex(state({ queue: q(1), index: 0, loopMode: 'all' }))).toEqual({ wrap: true, index: 0 });
  });

  it('returns null for an empty queue whatever the loop mode', () => {
    expect(nextIndex(state({ queue: q(0), index: 0, loopMode: 'all' }))).toBeNull();
    expect(nextIndex(state({ queue: q(0), index: 0 }))).toBeNull();
  });

  it('treats loop-one exactly like loop-off', () => {
    // Loop-one repeats a track through the backend's onEnded (seek 0 + play),
    // which never reaches this module. Pressing the Next BUTTON does reach it,
    // and must move on rather than replay.
    expect(nextIndex(state({ queue: q(5), index: 2, loopMode: 'one' }))).toEqual({ index: 3 });
    expect(nextIndex(state({ queue: q(5), index: 4, loopMode: 'one' }))).toBeNull();
  });
});

describe('prevIndex', () => {
  it('goes to the previous track within the first 3 seconds', () => {
    expect(prevIndex(state({ queue: q(5), index: 2 }), 0)).toEqual({ index: 1 });
    expect(prevIndex(state({ queue: q(5), index: 2 }), 3)).toEqual({ index: 1 });
  });

  it('restarts the current track after 3 seconds', () => {
    expect(prevIndex(state({ queue: q(5), index: 2 }), 3.01)).toEqual({ restart: true });
    expect(prevIndex(state({ queue: q(5), index: 2 }), 120)).toEqual({ restart: true });
  });

  it('wraps from the first track with loop-all regardless of how far in we are', () => {
    // The wrap is checked BEFORE the restart rule, so a late press still wraps.
    expect(prevIndex(state({ queue: q(5), index: 0, loopMode: 'all' }), 0)).toEqual({ index: 4 });
    expect(prevIndex(state({ queue: q(5), index: 0, loopMode: 'all' }), 99)).toEqual({ index: 4 });
  });

  it('wraps to the playlist end, not the radio tail', () => {
    const s = state({
      queue: q(10),
      index: 0,
      loopMode: 'all',
      baseCount: 4,
      context: { type: 'playlist', playlistId: 'p1', playlistName: 'Mix' },
    });
    expect(prevIndex(s, 99)).toEqual({ index: 3 });
  });

  it('restarts on the first track when loop is off or one', () => {
    expect(prevIndex(state({ queue: q(5), index: 0 }), 10)).toEqual({ restart: true });
    expect(prevIndex(state({ queue: q(5), index: 0, loopMode: 'one' }), 10)).toEqual({ restart: true });
  });

  it('has nowhere to go on the first track, early, without loop-all', () => {
    expect(prevIndex(state({ queue: q(5), index: 0 }), 0)).toBeNull();
    expect(prevIndex(state({ queue: q(5), index: 0, loopMode: 'one' }), 1)).toBeNull();
  });

  it('returns null for an empty queue', () => {
    expect(prevIndex(state({ queue: q(0), index: 0, loopMode: 'all' }), 0)).toBeNull();
  });
});

/** Minimal track shape: an id plus whether the server flagged it dead.
 *  Ported from the old tests/skip-unavailable.test.mjs, whose seven cases
 *  are the seven below. */
const t = (id: string, dead: boolean) => ({
  id,
  unavailableAt: dead ? '2026-09-09T00:00:00.000Z' : null,
});

describe('isUnavailable', () => {
  it('is true for a timestamp, false for null / undefined / empty', () => {
    expect(isUnavailable({ unavailableAt: '2026-09-09T00:00:00.000Z' })).toBe(true);
    expect(isUnavailable({ unavailableAt: null })).toBe(false);
    expect(isUnavailable({ unavailableAt: undefined })).toBe(false);
    expect(isUnavailable({ unavailableAt: '' })).toBe(false);
    expect(isUnavailable(null)).toBe(false);
  });
});

describe('nextPlayable', () => {
  it('returns the start itself when it is already playable, skipping nothing', () => {
    const queue = [t('a', false), t('b', false)];
    const r = nextPlayable(queue, 0, 1, false);
    expect(r.index).toBe(0);
    expect(r.skipped).toEqual([]);
  });

  it('walks forward over two dead tracks', () => {
    const queue = [t('live0', false), t('dead1', true), t('dead2', true), t('live3', false)];
    const r = nextPlayable(queue, 1, 1, false);
    expect(r.index).toBe(3);
    expect(r.skipped.map((x) => x.id)).toEqual(['dead1', 'dead2']);
  });

  it('walks backward over two dead tracks', () => {
    const queue = [t('live0', false), t('dead1', true), t('dead2', true), t('live3', false)];
    const r = nextPlayable(queue, 2, -1, false);
    expect(r.index).toBe(0);
    expect(r.skipped.map((x) => x.id)).toEqual(['dead2', 'dead1']);
  });

  it('wraps around one lap to find the far end; without wrap it gives up', () => {
    const queue = [t('dead0', true), t('live1', false), t('dead2', true)];
    expect(nextPlayable(queue, 2, 1, true).index).toBe(1);
    expect(nextPlayable(queue, 2, 1, false).index).toBe(-1);
  });

  it('reports -1 for an all-dead queue, listing each track exactly once', () => {
    const queue = [t('dead0', true), t('dead1', true), t('dead2', true)];
    const r = nextPlayable(queue, 0, 1, true);
    expect(r.index).toBe(-1);
    expect(r.skipped).toHaveLength(3);
    expect(r.skipped.map((x) => x.id).sort()).toEqual(['dead0', 'dead1', 'dead2']);
  });

  it('returns -1 for a start outside the queue when wrap is off', () => {
    const queue = [t('a', false)];
    expect(nextPlayable(queue, 5, 1, false).index).toBe(-1);
    expect(nextPlayable(queue, -1, -1, false).index).toBe(-1);
  });

  it('returns -1 for an empty queue', () => {
    expect(nextPlayable([], 0, 1, true).index).toBe(-1);
  });
});
