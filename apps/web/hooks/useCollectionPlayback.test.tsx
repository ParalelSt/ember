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

describe('useCollectionPlayback: Shuffle pressed on the list already playing', () => {
  const tracks = Array.from({ length: 12 }, (_, i) => t(`s${i}`));
  const ids = (list: Track[]) => list.map((s) => s.id);
  const sorted = (list: string[]) => [...list].sort();

  /** The list playing from song 5, a little way in. */
  const playing = (shuffleOn = false) => {
    usePlayerStore.setState({ queue: tracks, index: 5, position: 42, context: playlist, shuffle: shuffleOn, orderBackup: shuffleOn ? tracks : null });
    return renderHook(() => useCollectionPlayback(tracks, playlist));
  };

  it('keeps the song playing: no load, same song and position, shuffle on', () => {
    const { result } = playing();
    playTrack.mockClear();
    act(() => result.current.shuffle());
    const st = usePlayerStore.getState();
    expect(playTrack).not.toHaveBeenCalled();
    expect(st.queue[st.index].id).toBe('s5');
    expect(st.index).toBe(0);
    expect(st.position).toBe(42);
    expect(st.shuffle).toBe(true);
    expect(st.orderBackup).toEqual(tracks);
  });

  it('puts every other song, the played ones too, up next exactly once', () => {
    const { result } = playing();
    act(() => result.current.shuffle());
    const st = usePlayerStore.getState();
    expect(sorted(ids(st.queue))).toEqual(sorted(ids(tracks)));
    expect(st.queue.slice(1)).toHaveLength(11);
  });

  it('builds a new up next on every press, never a toggle off', () => {
    const { result } = playing(true);
    const seen = new Set<string>();
    for (let n = 0; n < 6; n++) {
      const before = ids(usePlayerStore.getState().queue.slice(1)).join();
      act(() => result.current.shuffle());
      const st = usePlayerStore.getState();
      expect(st.shuffle).toBe(true);
      expect(st.queue[0].id).toBe('s5');
      const after = ids(st.queue.slice(1)).join();
      expect(after).not.toBe(before);
      seen.add(after);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('never rebuilds the up next that is already queued (2 other songs)', () => {
    const three = [t('p'), t('q'), t('r')];
    usePlayerStore.setState({ queue: three, index: 0, context: playlist, shuffle: false, orderBackup: null });
    const { result } = renderHook(() => useCollectionPlayback(three, playlist));
    for (let n = 0; n < 30; n++) {
      const before = ids(usePlayerStore.getState().queue.slice(1)).join();
      act(() => result.current.shuffle());
      expect(ids(usePlayerStore.getState().queue.slice(1)).join()).not.toBe(before);
    }
  });

  it('keeps songs queued by hand right after the song playing', () => {
    const hand = { ...t('h'), queued: true } as Track;
    usePlayerStore.setState({ queue: [...tracks.slice(0, 6), hand, ...tracks.slice(6)], index: 5, context: playlist, shuffle: false, orderBackup: null });
    const { result } = renderHook(() => useCollectionPlayback(tracks, playlist));
    act(() => result.current.shuffle());
    expect(ids(usePlayerStore.getState().queue).slice(0, 2)).toEqual(['s5', 'h']);
  });
});

describe('useCollectionPlayback: Shuffle on a list that is not playing, again', () => {
  const tracks = Array.from({ length: 12 }, (_, i) => t(`s${i}`));

  it('shuffle-plays: a fresh order starting on a random song each time', () => {
    const { result } = renderHook(() => useCollectionPlayback(tracks, playlist));
    const firsts = new Set<string>();
    for (let n = 0; n < 40; n++) {
      act(() => usePlayerStore.setState({ context: { type: 'album', albumId: 'a', albumTitle: 'A' } as PlaybackContext }));
      playTrack.mockClear();
      act(() => result.current.shuffle());
      expect(playTrack).toHaveBeenCalledTimes(1);
      expect(usePlayerStore.getState().shuffle).toBe(true);
      firsts.add(usePlayerStore.getState().queue[0].id);
    }
    expect(firsts.size).toBeGreaterThan(3);
  });
});
