import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';
import { toast } from 'sonner';
import { QK, useExecuteToggleLike } from './useLibrary';
import type { Track } from '@/types/track';

/** A like or unlike the server never took (no connection to it, the host
 *  restarting) puts the heart back: the listener is told, not left to
 *  notice the heart quietly flip back, or not notice at all. */

vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
const api = vi.hoisted(() => ({ like: vi.fn(), unlike: vi.fn(), listLikes: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));
vi.mock('@/lib/offlineNative', () => ({ nativeOfflinePresent: () => false }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const track: Track = {
  id: 't1', source: 'youtube', sourceId: 't1', title: 'Song', artist: 'A', artistId: null,
  album: null, albumId: null, durationSec: 100, artworkUrl: null, streamUrl: '',
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listLikes.mockResolvedValue({ tracks: [] });
});

describe('useExecuteToggleLike: the server never took it', () => {
  it('a failed like puts the heart back and says so', async () => {
    api.like.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => ({ toggle: useExecuteToggleLike(), qc: useQueryClient() }), { wrapper });
    act(() => { result.current.qc.setQueryData(QK.likes, []); });

    act(() => { result.current.toggle.mutate({ track, wasLiked: false }); });
    await waitFor(() => expect(result.current.qc.isMutating()).toBe(0));

    expect(result.current.qc.getQueryData(QK.likes)).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith("Couldn't like that song");
  });

  it('a failed unlike says so too', async () => {
    api.unlike.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => ({ toggle: useExecuteToggleLike(), qc: useQueryClient() }), { wrapper });
    act(() => { result.current.qc.setQueryData(QK.likes, [track]); });

    act(() => { result.current.toggle.mutate({ track, wasLiked: true }); });
    await waitFor(() => expect(result.current.qc.isMutating()).toBe(0));

    expect(toast.error).toHaveBeenCalledWith("Couldn't remove that like");
  });
});
