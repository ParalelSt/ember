/** The sidebar, the phone Library and Home's tiles show each playlist's song
 *  count and the covers of its first songs, from the playlists list. Adding,
 *  removing, replacing or reordering a song changes those, so the list is
 *  asked again instead of showing the old count until the next 30 s poll. */
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  useExecuteAddToPlaylist,
  useExecuteRemoveFromPlaylist,
  useExecuteReorderPlaylist,
  useExecuteReplaceInPlaylist,
  useQueryPlaylists,
} from './useLibrary';
import type { Track } from '@/types/track';

vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
const api = vi.hoisted(() => ({
  listPlaylists: vi.fn(),
  addToPlaylist: vi.fn(),
  removeFromPlaylist: vi.fn(),
  replaceInPlaylist: vi.fn(),
  movePlaylistTrack: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api }));

function t(id: string): Track {
  return {
    id, source: 'youtube', sourceId: id, title: id, artist: 'x', artistId: null,
    album: null, albumId: null, durationSec: 100, artworkUrl: null, streamUrl: `/s/${id}`,
  };
}

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api.listPlaylists.mockResolvedValue({ playlists: [] });
  api.addToPlaylist.mockResolvedValue({ ok: true });
  api.removeFromPlaylist.mockResolvedValue({ ok: true });
  api.replaceInPlaylist.mockResolvedValue({ ok: true });
  api.movePlaylistTrack.mockResolvedValue({ ok: true });
});

async function listed() {
  const list = renderHook(() => useQueryPlaylists(), { wrapper });
  await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
  expect(api.listPlaylists).toHaveBeenCalledTimes(1);
}

describe('the playlists list follows song changes', () => {
  it('after adding a song', async () => {
    await listed();
    const { result } = renderHook(() => useExecuteAddToPlaylist(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'pl', track: t('a') });
    });
    await waitFor(() => expect(api.listPlaylists).toHaveBeenCalledTimes(2));
  });

  it('after removing a song', async () => {
    await listed();
    const { result } = renderHook(() => useExecuteRemoveFromPlaylist(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'pl', trackId: 'a' });
    });
    await waitFor(() => expect(api.listPlaylists).toHaveBeenCalledTimes(2));
  });

  it('after replacing a song', async () => {
    await listed();
    const { result } = renderHook(() => useExecuteReplaceInPlaylist(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'pl', trackId: 'a', track: t('b') });
    });
    await waitFor(() => expect(api.listPlaylists).toHaveBeenCalledTimes(2));
  });

  it('after reordering', async () => {
    await listed();
    client.setQueryData(['playlist', 'pl'], { playlist: { id: 'pl', name: 'P' }, tracks: [t('a'), t('b')] });
    const { result } = renderHook(() => useExecuteReorderPlaylist(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'pl', order: ['b', 'a'] });
    });
    await waitFor(() => expect(api.listPlaylists).toHaveBeenCalledTimes(2));
  });
});
