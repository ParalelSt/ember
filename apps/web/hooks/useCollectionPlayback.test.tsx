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
