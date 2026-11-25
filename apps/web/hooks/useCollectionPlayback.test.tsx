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

describe('useCollectionPlayback: Shuffle pressed on the list already playing (the player toggle)', () => {
  const tracks = Array.from({ length: 12 }, (_, i) => t(`s${i}`));
  const ids = (list: Track[]) => list.map((s) => s.id);
  const sorted = (list: string[]) => [...list].sort();
  const ORIGINAL = ids(tracks);

  /** The list playing from song 5, a little way in. */
  const playing = (shuffleOn = false) => {
    usePlayerStore.setState({ queue: tracks, index: 5, position: 42, context: playlist, shuffle: shuffleOn, orderBackup: shuffleOn ? tracks : null });
    return renderHook(() => useCollectionPlayback(tracks, playlist));
  };

  it('shuffle off: on turns it on, the song keeps playing (no load, same position), the rest re-dealt once each', () => {
    const { result } = playing();
    playTrack.mockClear();
    act(() => result.current.shuffle());
    const st = usePlayerStore.getState();
    expect(playTrack).not.toHaveBeenCalled();
    expect(st.queue[st.index].id).toBe('s5');
    expect(st.position).toBe(42);
    expect(st.shuffle).toBe(true);
    expect(sorted(ids(st.queue))).toEqual(sorted(ORIGINAL));
    expect(result.current.shuffleOn).toBe(true);
    expect(result.current.active).toBe(true);
  });

  it('shuffle on: a press turns it OFF, original order back around the song playing', () => {
    const { result } = playing();
    act(() => result.current.shuffle());
    playTrack.mockClear();
    act(() => result.current.shuffle());
    const st = usePlayerStore.getState();
    expect(playTrack).not.toHaveBeenCalled();
    expect(st.shuffle).toBe(false);
    expect(st.orderBackup).toBeNull();
    expect(ids(st.queue)).toEqual(ORIGINAL);
    expect(st.queue[st.index].id).toBe('s5');
    expect(st.position).toBe(42);
    expect(result.current.shuffleOn).toBe(false);
  });

  it('off then on again gives a fresh order', () => {
    const { result } = playing();
    const seen = new Set<string>();
    for (let n = 0; n < 6; n++) {
      act(() => result.current.shuffle());
      const st = usePlayerStore.getState();
      expect(st.shuffle).toBe(true);
      expect(st.queue[st.index].id).toBe('s5');
      seen.add(ids(st.queue).join());
      act(() => result.current.shuffle());
      expect(ids(usePlayerStore.getState().queue)).toEqual(ORIGINAL);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('keeps songs queued by hand right after the song playing when turned on', () => {
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
