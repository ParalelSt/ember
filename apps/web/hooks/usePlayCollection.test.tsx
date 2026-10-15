import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePlayCollection } from './usePlayCollection';
import { usePlayerStore } from '@/stores/usePlayerStore';
import type { PlaybackContext, Track } from '@/types/track';

const player = vi.hoisted(() => ({ playTrack: vi.fn(), toggle: vi.fn(), isPlaying: false }));
vi.mock('@/components/player/PlayerProvider', () => ({ usePlayer: () => player }));

const api = vi.hoisted(() => ({ listLikes: vi.fn(), getPlaylist: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const t = (id: string): Track => ({
  id, source: 'youtube', sourceId: id, title: id, artist: 'A', artistId: null, album: null, albumId: null,
  durationSec: 100, artworkUrl: null, streamUrl: '',
});

let client: QueryClient;
function setup() {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => usePlayCollection(), { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  player.isPlaying = false;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  usePlayerStore.setState({ context: null });
});

describe('usePlayCollection', () => {
  it('plays a playlist from its first song, with the playlist as the context', async () => {
    const songs = [t('a'), t('b')];
    api.getPlaylist.mockResolvedValue({ playlist: { id: 'p1', name: 'Road trip' }, tracks: songs });
    const { result } = setup();
    await act(() => result.current.play({ kind: 'playlist', id: 'p1' }, 'Road trip'));
    expect(api.getPlaylist).toHaveBeenCalledWith('p1');
    expect(player.playTrack).toHaveBeenCalledWith(songs[0], songs, { type: 'playlist', playlistId: 'p1', playlistName: 'Road trip' });
  });

  it('plays Liked songs, using the cached list when there is one', async () => {
    const songs = [t('l1'), t('l2')];
    client.setQueryData(['likes'], songs);
    const { result } = setup();
    await act(() => result.current.play({ kind: 'liked' }, 'Liked songs'));
    expect(api.listLikes).not.toHaveBeenCalled();
    expect(player.playTrack).toHaveBeenCalledWith(songs[0], songs, { type: 'liked' });
  });

  it('toggles instead when that collection is already the one playing', async () => {
    usePlayerStore.setState({ context: { type: 'playlist', playlistId: 'p1', playlistName: 'Road trip' } as PlaybackContext });
    player.isPlaying = true;
    const { result } = setup();
    expect(result.current.isPlaying({ kind: 'playlist', id: 'p1' })).toBe(true);
    expect(result.current.isPlaying({ kind: 'playlist', id: 'p2' })).toBe(false);
    expect(result.current.isPlaying({ kind: 'liked' })).toBe(false);
    await act(() => result.current.play({ kind: 'playlist', id: 'p1' }, 'Road trip'));
    expect(player.toggle).toHaveBeenCalledTimes(1);
    expect(player.playTrack).not.toHaveBeenCalled();
    expect(api.getPlaylist).not.toHaveBeenCalled();
  });

  it('says so when the playlist cannot be loaded or is empty, and plays nothing', async () => {
    api.getPlaylist.mockRejectedValueOnce(new Error('down'));
    const { result } = setup();
    await act(() => result.current.play({ kind: 'playlist', id: 'p1' }, 'Road trip'));
    expect(toast.error).toHaveBeenCalledWith("Couldn't load Road trip right now");
    api.getPlaylist.mockResolvedValueOnce({ playlist: { id: 'p2', name: 'Empty' }, tracks: [] });
    await act(() => result.current.play({ kind: 'playlist', id: 'p2' }, 'Empty'));
    expect(toast).toHaveBeenCalledWith('Empty has no songs yet');
    expect(player.playTrack).not.toHaveBeenCalled();
  });
});
