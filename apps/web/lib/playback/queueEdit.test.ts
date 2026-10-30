import { describe, expect, it } from 'vitest';
import { clearUpcoming, moveUpcoming, playNextUpcoming, removeUpcoming, shuffleUpcoming } from './queueEdit';
import { addToQueue, type QueuedTrack } from './addToQueue';
import { nextIndex, playedWalk, prevIndex } from './queueNav';
import { makeTrack } from '../../test-utils/fakeBackend';
import type { Track } from '../../types/track';

const t = (id: string) => makeTrack({ id: `youtube:${id}`, title: id });
const ids = (q: Track[]) => q.map((x) => x.title);
const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map(t);

describe('queue sheet edits to Next up', () => {
  const state = { queue: [a, b, c, d, e], index: 1, baseCount: 5 };

  it('moves a song inside Next up and leaves the song playing where it is', () => {
    const edit = moveUpcoming(state, 4, 2);
    expect(ids(edit!.queue)).toEqual(['a', 'b', 'e', 'c', 'd']);
    expect(edit!.baseCount).toBe(5);
    // Next follows the new order from the same index.
    expect(nextIndex({ ...state, ...edit!, loopMode: 'off', context: null })).toEqual({ index: 2 });
    expect(edit!.queue[2]).toBe(e);
  });

  it('never touches the song playing or the songs before it', () => {
    expect(moveUpcoming(state, 1, 3)).toBeNull();
    expect(moveUpcoming(state, 3, 0)).toBeNull();
    expect(moveUpcoming(state, 3, 1)).toBeNull();
    expect(moveUpcoming(state, 3, 5)).toBeNull();
    expect(moveUpcoming(state, 3, 3)).toBeNull();
    expect(removeUpcoming(state, 1)).toBeNull();
    expect(removeUpcoming(state, 0)).toBeNull();
    expect(removeUpcoming(state, 9)).toBeNull();
    expect(playNextUpcoming(state, 1)).toBeNull();
    expect(moveUpcoming({ ...state, index: -1 }, 2, 3)).toBeNull();
  });

  it('removes a song from Next up; Previous still walks back over the same songs', () => {
    const edit = removeUpcoming(state, 3);
    expect(ids(edit!.queue)).toEqual(['a', 'b', 'c', 'e']);
    expect(edit!.baseCount).toBe(4);
    expect(prevIndex({ ...state, ...edit!, loopMode: 'off', context: null }, 0)).toEqual({ index: 0 });
    // The play history (ids) still lands on the song really played before.
    expect(playedWalk(edit!.queue, 1, [a.id]).map((step) => step.index)).toEqual([0]);
  });

  it('Play next puts the song right after the one playing, as queued by hand', () => {
    const edit = playNextUpcoming(state, 4);
    expect(ids(edit!.queue)).toEqual(['a', 'b', 'e', 'c', 'd']);
    expect((edit!.queue[2] as QueuedTrack).queued).toBe(true);
    // A later "Add to queue" lines up after it.
    const added = addToQueue({ ...state, ...edit! }, t('x'));
    expect(ids(added!.queue)).toEqual(['a', 'b', 'e', 'x', 'c', 'd']);
  });

  it('Play next on the song already next only marks it (or does nothing)', () => {
    const edit = playNextUpcoming(state, 2);
    expect(ids(edit!.queue)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect((edit!.queue[2] as QueuedTrack).queued).toBe(true);
    expect(playNextUpcoming({ ...state, ...edit! }, 2)).toBeNull();
  });

  it('keeps the playlist part of the queue (the loop-all wrap point) with its songs', () => {
    // a b c are the playlist (b playing), d e came from radio.
    const s = { queue: [a, b, c, d, e], index: 1, baseCount: 3 };
    // A radio song dropped inside the playlist joins it.
    expect(moveUpcoming(s, 4, 2)!.baseCount).toBe(4);
    // A radio song moved within the radio part, or to the edge, stays radio.
    expect(moveUpcoming(s, 4, 3)!.baseCount).toBe(3);
    // A playlist song moved past the radio songs leaves the playlist.
    expect(moveUpcoming(s, 2, 4)!.baseCount).toBe(2);
    // Removing a playlist song shrinks it, a radio song does not.
    expect(removeUpcoming(s, 2)!.baseCount).toBe(2);
    expect(removeUpcoming(s, 3)!.baseCount).toBe(3);
    // Play next on a radio song: it is now inside the playlist part.
    expect(playNextUpcoming(s, 4)!.baseCount).toBe(4);
  });

  it('a playlist song swapped with the playlist song after it stays in the playlist part', () => {
    const s = { queue: [a, b, c, d, e], index: 0, baseCount: 3 };
    const edit = moveUpcoming(s, 1, 2);
    expect(ids(edit!.queue)).toEqual(['a', 'c', 'b', 'd', 'e']);
    expect(edit!.baseCount).toBe(3);
  });

  it('Clear empties Next up and keeps the song playing and the ones before it', () => {
    const edit = clearUpcoming(state);
    expect(ids(edit!.queue)).toEqual(['a', 'b']);
    expect(edit!.baseCount).toBe(2);
    expect(nextIndex({ ...state, ...edit!, loopMode: 'off', context: null })).toBeNull();
    expect(clearUpcoming({ ...state, ...edit! })).toBeNull();
    expect(clearUpcoming({ queue: [], index: -1, baseCount: 0 })).toBeNull();
  });

  it('Shuffle reorders Next up once, the same songs, the head untouched', () => {
    let seed = 0.37;
    const rng = () => {
      seed = (seed * 9301 + 0.49297) % 1;
      return seed;
    };
    const s = { queue: [a, b, c, d, e, t('f'), t('g')], index: 1, baseCount: 7 };
    const edit = shuffleUpcoming(s, rng);
    expect(ids(edit!.queue.slice(0, 2))).toEqual(['a', 'b']);
    expect(ids(edit!.queue.slice(2)).sort()).toEqual(['c', 'd', 'e', 'f', 'g']);
    expect(ids(edit!.queue.slice(2))).not.toEqual(['c', 'd', 'e', 'f', 'g']);
    expect(edit!.baseCount).toBe(7);
    // Nothing to shuffle with fewer than two songs ahead.
    expect(shuffleUpcoming({ queue: [a, b, c], index: 1, baseCount: 3 })).toBeNull();
  });

  it('works on a list holding the same song twice, by position', () => {
    const s = { queue: [a, b, a, c], index: 0, baseCount: 4 };
    const edit = moveUpcoming(s, 3, 1);
    expect(ids(edit!.queue)).toEqual(['a', 'c', 'b', 'a']);
    expect(edit!.queue[0]).toBe(a);
  });
});
