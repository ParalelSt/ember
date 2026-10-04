import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QK, useExecuteToggleLike, useQueryLikes } from './useLibrary';
import type { Track } from '@/types/track';

vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

const api = vi.hoisted(() => ({ like: vi.fn(), unlike: vi.fn(), listLikes: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));
vi.mock('@/lib/offlineNative', () => ({ nativeOfflinePresent: () => false }));

const track: Track = {
  id: 't1', source: 'youtube', sourceId: 't1', title: 'Song', artist: 'A', artistId: null,
  album: null, albumId: null, durationSec: 100, artworkUrl: null, streamUrl: '',
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** A request the test answers by hand. */
function deferred() {
  let resolve!: (v: unknown) => void;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useExecuteToggleLike: a quick like then unlike', () => {
  it('sends the unlike only once the like has landed, so the server ends up unliked', async () => {
    const likeReq = deferred();
    // The server's list, as each request leaves it.
    let serverLiked = false;
    api.like.mockImplementation(() => likeReq.promise.then(() => { serverLiked = true; return { ok: true }; }));
    api.unlike.mockImplementation(async () => { serverLiked = false; return { ok: true }; });
    api.listLikes.mockImplementation(async () => ({ tracks: serverLiked ? [track] : [] }));

    const { result } = renderHook(() => ({ toggle: useExecuteToggleLike(), qc: useQueryClient() }), { wrapper });
    act(() => { result.current.qc.setQueryData(QK.likes, []); });

    act(() => { result.current.toggle.mutate({ track, wasLiked: false }); });
    act(() => { result.current.toggle.mutate({ track, wasLiked: true }); });
    // The like is still on its way: the unlike must wait for it, or the
    // server may handle the unlike first and keep the like for good.
    await Promise.resolve();
    expect(api.unlike).not.toHaveBeenCalled();

    await act(async () => { likeReq.resolve(undefined); });
    await waitFor(() => expect(api.unlike).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.qc.isMutating()).toBe(0));
    expect(serverLiked).toBe(false);
  });

  it('does not flash the heart back on with the first answer while the second toggle is still pending', async () => {
    const unlikeReq = deferred();
    let serverLiked = false;
    api.like.mockImplementation(async () => { serverLiked = true; return { ok: true }; });
    api.unlike.mockImplementation(() => unlikeReq.promise.then(() => { serverLiked = false; return { ok: true }; }));
    api.listLikes.mockImplementation(async () => ({ tracks: serverLiked ? [track] : [] }));

    // The heart is on screen: the liked list has an observer, so an
    // invalidation refetches it.
    const { result } = renderHook(() => ({ toggle: useExecuteToggleLike(), qc: useQueryClient(), likes: useQueryLikes() }), { wrapper });
    await waitFor(() => expect(result.current.likes.data).toEqual([]));

    act(() => { result.current.toggle.mutate({ track, wasLiked: false }); });
    act(() => { result.current.toggle.mutate({ track, wasLiked: true }); });
    await waitFor(() => expect(api.unlike).toHaveBeenCalledTimes(1));
    // While the unlike is in flight the list must still read "not liked".
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.likes.data).toEqual([]);

    await act(async () => { unlikeReq.resolve(undefined); });
    await waitFor(() => expect(result.current.qc.isMutating()).toBe(0));
  });
});
