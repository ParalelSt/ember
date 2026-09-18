import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSearchQuery } from './useSearchQuery';
import type { Track } from '@/types/track';

vi.mock('@/lib/useOnline', () => ({ useOnline: () => true }));

vi.mock('@/hooks/useVoiceSearch', () => ({
  useVoiceSearch: () => ({ supported: false, listening: false, toggle: vi.fn() }),
}));

const trackActions = vi.hoisted(() => ({
  currentId: null as string | null,
  isPlaying: false,
  likedIds: new Set<string>(),
  onPlay: vi.fn(),
  onToggle: vi.fn(),
  onLike: vi.fn(),
  artworkSrcFor: vi.fn(() => null),
}));
vi.mock('@/hooks/useTrackActions', () => ({ useTrackActions: () => trackActions }));

const recents = vi.hoisted(() => ({ tracks: [] as Track[], removeMutate: vi.fn(), addMutate: vi.fn() }));
vi.mock('@/hooks/useRecentSearches', () => ({
  useQueryRecentSearches: () => ({ data: recents.tracks }),
  useExecuteAddRecentSearch: () => ({ mutate: recents.addMutate }),
  useExecuteRemoveRecentSearch: () => ({ mutate: recents.removeMutate }),
}));

const api = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

function makeTrack(over: Partial<Track> = {}): Track {
  return {
    id: 'youtube:a1',
    source: 'youtube',
    sourceId: 'a1',
    title: 'Midnight Drive',
    artist: 'The Nulls',
    artistId: 'art1',
    album: 'Night Shift',
    albumId: 'alb1',
    durationSec: 191,
    artworkUrl: null,
    streamUrl: '',
    ...over,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  recents.tracks = [];
});

describe('useSearchQuery', () => {
  it('debounces typing into debouncedQ, trimming whitespace', async () => {
    const { result } = renderHook(() => useSearchQuery(), { wrapper });

    act(() => result.current.setQ('  daft punk  '));
    expect(result.current.debouncedQ).toBe('');

    await waitFor(() => expect(result.current.debouncedQ).toBe('daft punk'));
  });

  it('surfaces the rate-limit message via rateLimited', async () => {
    api.search.mockRejectedValue({ status: 429 });
    const { result } = renderHook(() => useSearchQuery(), { wrapper });

    act(() => result.current.setQ('daft punk'));
    await waitFor(() => expect(result.current.rateLimited).toBe(true));
  });

  it('onPlay saves the track to recent searches and plays it', async () => {
    const track = makeTrack();
    const { result } = renderHook(() => useSearchQuery(), { wrapper });

    act(() => result.current.onPlay(track, [track], { type: 'search', query: 'midnight' }));

    expect(recents.addMutate).toHaveBeenCalledWith(track);
    expect(trackActions.onPlay).toHaveBeenCalledWith(track, [track], { type: 'search', query: 'midnight' });
  });
});
