import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QK, useExecuteRecordPlay, useQueryHistory } from './useLibrary';
import { useHeldOrder } from './useHeldOrder';
import type { Track } from '@/types/track';

const auth = vi.hoisted(() => ({ user: { id: 'u1' } as { id: string } | null }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => auth }));

const api = vi.hoisted(() => ({ recordPlay: vi.fn(), getHistory: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));
vi.mock('@/lib/offlineNative', () => ({ nativeOfflinePresent: () => false }));

function makeTrack(id: string): Track {
  return {
    id,
    source: 'youtube',
    sourceId: id,
    title: `Track ${id}`,
    artist: 'Artist',
    artistId: null,
    album: null,
    albumId: null,
    durationSec: 100,
    artworkUrl: null,
    streamUrl: '',
  };
}

const ids = (list: Track[]) => list.map((t) => t.id);

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useHeldOrder: Recently played stays in place while on the page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.user = { id: 'u1' };
    api.getHistory.mockResolvedValue({ tracks: [makeTrack('a'), makeTrack('b'), makeTrack('c')] });
    api.recordPlay.mockResolvedValue({});
  });

  it('reproduces: playing a song moves it to the top of the history cache', async () => {
    const { result } = renderHook(
      () => ({ mutate: useExecuteRecordPlay(), history: useQueryHistory() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.history.data).toHaveLength(3));
    act(() => result.current.mutate.mutate(makeTrack('c')));
    await waitFor(() => expect(ids(client.getQueryData<Track[]>(QK.history)!)).toEqual(['c', 'a', 'b']));
  });

  it('keeps the order it had when a played song jumps to the top of the cache', async () => {
    const { result } = renderHook(
      () => {
        const history = useQueryHistory();
        return { mutate: useExecuteRecordPlay(), shown: useHeldOrder(history.data ?? []) };
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.shown).toHaveLength(3));
    act(() => result.current.mutate.mutate(makeTrack('c')));
    await waitFor(() => expect(ids(client.getQueryData<Track[]>(QK.history)!)[0]).toBe('c'));
    expect(ids(result.current.shown)).toEqual(['a', 'b', 'c']);
  });

  it('shows songs that arrive while on the page at the top, in their own order', async () => {
    const { result, rerender } = renderHook(({ list }: { list: Track[] }) => useHeldOrder(list), {
      wrapper,
      initialProps: { list: [makeTrack('a'), makeTrack('b')] },
    });
    rerender({ list: [makeTrack('x'), makeTrack('b'), makeTrack('a')] });
    expect(ids(result.current)).toEqual(['x', 'a', 'b']);
  });

  it('drops songs that are gone from the list', async () => {
    const { result, rerender } = renderHook(({ list }: { list: Track[] }) => useHeldOrder(list), {
      wrapper,
      initialProps: { list: [makeTrack('a'), makeTrack('b'), makeTrack('c')] },
    });
    rerender({ list: [makeTrack('c'), makeTrack('a')] });
    expect(ids(result.current)).toEqual(['a', 'c']);
  });
});
