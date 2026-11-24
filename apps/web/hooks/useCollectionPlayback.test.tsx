import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCollectionPlayback } from './useCollectionPlayback';
import { usePlayerStore } from '@/stores/usePlayerStore';
import type { PlaybackContext, Track } from '@/types/track';

/** playTrack as the provider does it: a list with nothing playable is
 *  refused (a toast) and the queue stays as it was. */
const playTrack = vi.hoisted(() => vi.fn());
vi.mock('@/components/player/PlayerProvider', () => ({ usePlayer: () => ({ playTrack }) }));

const t = (id: string, dead = false): Track => ({
  id, source: 'youtube', sourceId: id, title: id, artist: 'A', artistId: null, album: null, albumId: null,
  durationSec: 100, artworkUrl: null, streamUrl: '', unavailableAt: dead ? '2026-01-01' : null,
});

const playlist: PlaybackContext = { type: 'playlist', playlistId: 'p1', playlistName: 'P' } as PlaybackContext;
const before = [t('x1'), t('x2'), t('x3')];

beforeEach(() => {
  playTrack.mockReset().mockImplementation((track: Track, list: Track[], context: PlaybackContext) => {
    if (list.every((s) => s.unavailableAt)) return;
    usePlayerStore.setState({ queue: list, index: list.indexOf(track), context, shuffle: false, orderBackup: null });
  });
  usePlayerStore.setState({ queue: before, index: 1, context: { type: 'album', albumId: 'a', albumTitle: 'A' } as PlaybackContext, shuffle: false, orderBackup: null });
});

describe('useCollectionPlayback: Shuffle on a list that is not playing', () => {
  it('leaves the queue playing alone when nothing in the list can play', () => {
    const { result } = renderHook(() => useCollectionPlayback([t('d1', true), t('d2', true)], playlist));
    act(() => result.current.shuffle());
    const st = usePlayerStore.getState();
    expect(st.queue).toEqual(before);
    expect(st.shuffle).toBe(false);
    expect(st.orderBackup).toBeNull();
  });

  it('shuffles and remembers the order when the list plays', () => {
    const tracks = [t('a'), t('b'), t('c')];
    const { result } = renderHook(() => useCollectionPlayback(tracks, playlist));
    act(() => result.current.shuffle());
    const st = usePlayerStore.getState();
    expect(st.shuffle).toBe(true);
    expect(st.orderBackup).toEqual(tracks);
  });
});

describe('useCollectionPlayback: Shuffle pressed again on the list already playing', () => {
  const tracks = Array.from({ length: 12 }, (_, i) => t(`s${i}`));
  const ids = (list: Track[]) => list.map((s) => s.id).join(',');

  /** What the first press leaves behind: the list shuffled and playing. */
  const firstPress = () => {
    const hook = renderHook(() => useCollectionPlayback(tracks, playlist));
    act(() => hook.result.current.shuffle());
    return hook;
  };

  it('builds a fresh order and replaces the queue on every press, never a toggle', () => {
    const { result } = firstPress();
    const seen = new Set([ids(usePlayerStore.getState().queue)]);
    for (let n = 0; n < 5; n++) {
      playTrack.mockClear();
      act(() => result.current.shuffle());
      expect(playTrack).toHaveBeenCalledTimes(1);
      const st = usePlayerStore.getState();
      expect(st.shuffle).toBe(true);
      expect(st.orderBackup).toEqual(tracks);
      expect([...st.queue].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...tracks].sort((a, b) => a.id.localeCompare(b.id)));
      seen.add(ids(st.queue));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('never rebuilds the order that is already queued', () => {
    const two = [t('p'), t('q')];
    const { result } = renderHook(() => useCollectionPlayback(two, playlist));
    act(() => result.current.shuffle());
    for (let n = 0; n < 30; n++) {
      const queued = ids(usePlayerStore.getState().queue);
      act(() => result.current.shuffle());
      expect(ids(usePlayerStore.getState().queue)).not.toBe(queued);
    }
  });

  it('starts somewhere random each time, not always the same first song', () => {
    const { result } = firstPress();
    const firsts = new Set<string>();
    for (let n = 0; n < 40; n++) {
      act(() => result.current.shuffle());
      firsts.add(usePlayerStore.getState().queue[0].id);
    }
    expect(firsts.size).toBeGreaterThan(3);
  });

  it('shuffle-plays when shuffle is off but the list is playing too', () => {
    const { result } = renderHook(() => useCollectionPlayback(tracks, playlist));
    act(() => result.current.play());
    expect(usePlayerStore.getState().shuffle).toBe(false);
    playTrack.mockClear();
    act(() => result.current.shuffle());
    expect(playTrack).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().shuffle).toBe(true);
  });
});
