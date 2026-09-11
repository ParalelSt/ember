import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { useCollections } from './useCollections';
import { useOfflineStore } from '@/stores/useOfflineStore';
import type { Playlist, Track } from '@/types/track';

const auth = vi.hoisted(() => ({ user: { id: 'u1' } as { id: string } | null }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => auth }));

const api = vi.hoisted(() => ({
  listPlaylists: vi.fn(),
  listLikes: vi.fn(),
  getHistory: vi.fn(),
  listUploads: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api }));

function makeTrack(id: string): Track {
  return {
    id,
    source: 'youtube',
    sourceId: id,
    title: 'Track',
    artist: 'Artist',
    artistId: 'art1',
    album: 'Album',
    albumId: 'alb1',
    durationSec: 100,
    artworkUrl: null,
    streamUrl: '',
  };
}

function makePlaylist(id: string, name: string, artwork_url: string | null = null): Playlist {
  return { id, name, created_at: '2024-01-01', artwork_url };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function setup() {
  return renderHook(() => useCollections(), { wrapper });
}

beforeEach(() => {
  auth.user = { id: 'u1' };
  vi.clearAllMocks();
  api.listPlaylists.mockResolvedValue({
    playlists: [makePlaylist('p1', 'Road Trip', 'https://example.com/a.jpg'), makePlaylist('p2', 'Chill')],
  });
  api.listLikes.mockResolvedValue({ tracks: [makeTrack('t1'), makeTrack('t2'), makeTrack('t3')] });
  api.getHistory.mockResolvedValue({ tracks: [makeTrack('t4')] });
  api.listUploads.mockResolvedValue({ tracks: [] });
  useOfflineStore.setState({ downloaded: ['p1'] });
});

describe('useCollections', () => {
  it('builds the three system summaries in order, with counts and downloaded ids from the offline store', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.system.map((s) => s.ref)).toEqual([{ kind: 'liked' }, { kind: 'recent' }, { kind: 'uploads' }]);
    expect(result.current.system.map((s) => s.subtitle)).toEqual(['3 songs', '1 song', '0 songs']);
    expect(result.current.downloadedIds.has('p1')).toBe(true);
    expect(result.current.downloadedIds.has('liked')).toBe(false);
  });

  it('builds playlist summaries with names, artwork and the downloaded flag', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.playlists).toEqual([
      {
        ref: { kind: 'playlist', id: 'p1' },
        title: 'Road Trip',
        subtitle: 'Downloaded',
        href: '/playlist/p1',
        pinId: 'p1',
        icon: null,
        artworkUrl: 'https://example.com/a.jpg',
        downloaded: true,
      },
      {
        ref: { kind: 'playlist', id: 'p2' },
        title: 'Chill',
        subtitle: 'Playlist',
        href: '/playlist/p2',
        pinId: 'p2',
        icon: null,
        artworkUrl: null,
        downloaded: false,
      },
    ]);
  });
});
