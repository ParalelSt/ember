/** Removing a song from the playlist that is playing takes it out of the live
 *  queue too. The queue's curated part (baseCount, where loop-all wraps) has
 *  to shrink with it, or loop-all ran one song into the radio tail before
 *  wrapping (bughunt 2026-09-25 P3). */
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { useExecuteRemoveFromPlaylist } from './useLibrary';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { nextIndex } from '@/lib/playback/queueNav';
import type { Track } from '@/types/track';

vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
const api = vi.hoisted(() => ({ removeFromPlaylist: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/api', () => ({ api }));

function t(id: string): Track {
  return {
    id, source: 'youtube', sourceId: id, title: id, artist: 'x', artistId: null,
    album: null, albumId: null, durationSec: 100, artworkUrl: null, streamUrl: `/s/${id}`,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  // A 4-song playlist that radio has extended with two songs.
  usePlayerStore.setState({
    queue: ['p1', 'p2', 'p3', 'p4', 'r1', 'r2'].map(t),
    index: 0,
    context: { type: 'playlist', playlistId: 'pl' } as never,
    baseCount: 4,
    loopMode: 'all',
    shuffle: false,
    orderBackup: null,
  });
});

describe('removing a song from the playing playlist', () => {
  it('shrinks the curated part, so loop-all still wraps at the playlist end', async () => {
    const { result } = renderHook(() => useExecuteRemoveFromPlaylist(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'pl', trackId: 'p2' });
    });
    const s = usePlayerStore.getState();
    expect(s.queue.map((x) => x.id)).toEqual(['p1', 'p3', 'p4', 'r1', 'r2']);
    expect(s.baseCount).toBe(3);
    // On the playlist's last song, loop-all goes back to its first.
    expect(nextIndex({ ...s, index: 2 })).toEqual({ wrap: true, index: 0 });
  });

  it('leaves the curated part alone for a song after it', async () => {
    usePlayerStore.setState({ baseCount: 4 });
    const { result } = renderHook(() => useExecuteRemoveFromPlaylist(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'pl', trackId: 'r1' });
    });
    expect(usePlayerStore.getState().baseCount).toBe(4);
  });
});
