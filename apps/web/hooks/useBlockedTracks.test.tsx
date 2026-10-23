import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useBlockedTracks } from './useBlockedTracks';
import type { Track } from '@/types/track';

vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

const api = vi.hoisted(() => ({
  listBlockedTracks: vi.fn(),
  blockTrack: vi.fn(),
  unblockTrack: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api }));

function makeTrack(over: Partial<Track> = {}): Track {
  return {
    id: 'youtube:a1',
    source: 'youtube',
    sourceId: 'a1',
    title: 'Midnight Drive',
    artist: 'The Nulls',
    artistId: null,
    album: null,
    albumId: null,
    durationSec: 191,
    artworkUrl: null,
    streamUrl: '',
    ...over,
  };
}

const blockedSong = makeTrack();
// Another upload of the same song: the menus call it blocked too.
const variant = makeTrack({ id: 'youtube:b2', sourceId: 'b2', title: 'Midnight Drive (Lyric Video)' });

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  let rows = [blockedSong];
  api.listBlockedTracks.mockImplementation(async () => ({ tracks: rows }));
  api.unblockTrack.mockImplementation(async (id: string) => {
    rows = rows.filter((t) => t.id !== id);
    return { ok: true };
  });
});

describe('useBlockedTracks', () => {
  it('unblocking another upload of a blocked song unblocks the song that was blocked', async () => {
    const { result } = renderHook(() => useBlockedTracks(), { wrapper });
    await waitFor(() => expect(result.current.isBlocked(variant)).toBe(true));

    await act(async () => {
      await result.current.unblock(variant);
    });

    expect(api.unblockTrack).toHaveBeenCalledWith(blockedSong.id);
    await waitFor(() => expect(result.current.isBlocked(variant)).toBe(false));
    expect(result.current.isBlocked(blockedSong)).toBe(false);
  });

  it('unblocks the song itself by its own id', async () => {
    const { result } = renderHook(() => useBlockedTracks(), { wrapper });
    await waitFor(() => expect(result.current.blocked).toHaveLength(1));

    await act(async () => {
      await result.current.unblock(blockedSong);
    });

    expect(api.unblockTrack).toHaveBeenCalledTimes(1);
    expect(api.unblockTrack).toHaveBeenCalledWith(blockedSong.id);
  });
});
