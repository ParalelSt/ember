/** Turning shuffle off restores the order from before shuffling, but the queue
 *  may have changed since: songs added (a carlist session appending the
 *  group's picks), songs removed (from the playing playlist), a song flagged
 *  unavailable. Restoring the old snapshot wholesale dropped the added songs,
 *  brought the removed ones back, and cleared the unavailable flag (bughunt
 *  2026-09-25 P2). */
import { beforeEach, describe, expect, it } from 'vitest';
import { usePlayerStore } from './usePlayerStore';
import type { Track } from '@/types/track';

function t(id: string, over: Partial<Track> = {}): Track {
  return {
    id, source: 'youtube', sourceId: id, title: id, artist: 'x', artistId: null,
    album: null, albumId: null, durationSec: 100, artworkUrl: null, streamUrl: `/s/${id}`, ...over,
  };
}
const ORIGINAL = ['a', 'b', 'c', 'd', 'e'].map((id) => t(id));
const ids = () => usePlayerStore.getState().queue.map((x) => x.id);
const current = () => {
  const s = usePlayerStore.getState();
  return s.queue[s.index]?.id;
};

beforeEach(() => {
  usePlayerStore.setState({ queue: ORIGINAL, index: 1, shuffle: false, orderBackup: null });
  usePlayerStore.getState().toggleShuffle();
});

describe('shuffle off after the queue changed', () => {
  it('keeps songs appended while shuffled (a carlist session), after the original order', () => {
    usePlayerStore.setState((s) => ({ queue: [...s.queue, t('x'), t('y')] }));
    usePlayerStore.getState().toggleShuffle();
    expect(ids()).toEqual(['a', 'b', 'c', 'd', 'e', 'x', 'y']);
    expect(current()).toBe('b');
  });

  it('does not bring back a song removed while shuffled', () => {
    usePlayerStore.setState((s) => {
      const i = s.queue.findIndex((x) => x.id === 'd');
      return { queue: s.queue.filter((_, j) => j !== i), index: i < s.index ? s.index - 1 : s.index };
    });
    usePlayerStore.getState().toggleShuffle();
    expect(ids()).toEqual(['a', 'b', 'c', 'e']);
    expect(current()).toBe('b');
  });

  it('keeps an unavailable flag set while shuffled', () => {
    usePlayerStore.setState((s) => ({
      queue: s.queue.map((x) => (x.id === 'c' ? { ...x, unavailableAt: '2026-09-25T00:00:00Z' } : x)),
    }));
    usePlayerStore.getState().toggleShuffle();
    const c = usePlayerStore.getState().queue.find((x) => x.id === 'c');
    expect(c?.unavailableAt).toBe('2026-09-25T00:00:00Z');
  });

  it('keeps a song that is in the playlist twice twice', () => {
    const dup = [t('a'), t('b'), t('a'), t('c')];
    usePlayerStore.setState({ queue: dup, index: 0, shuffle: false, orderBackup: null });
    usePlayerStore.getState().toggleShuffle();
    usePlayerStore.getState().toggleShuffle();
    expect(ids()).toEqual(['a', 'b', 'a', 'c']);
  });

  it('an unchanged queue restores exactly as before', () => {
    usePlayerStore.getState().toggleShuffle();
    expect(ids()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(current()).toBe('b');
    expect(usePlayerStore.getState().orderBackup).toBeNull();
  });
});
