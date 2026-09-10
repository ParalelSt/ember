import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useCreatePlaylistFlow } from './useCreatePlaylistFlow';
import type { Track } from '@/types/track';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const api = vi.hoisted(() => ({
  createPlaylist: vi.fn(),
  addToPlaylist: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api }));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

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

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.createPlaylist.mockResolvedValue({ playlist: { id: 'p1', name: 'Road Trip', created_at: '2024-01-01', artwork_url: null } });
  api.addToPlaylist.mockResolvedValue({ ok: true });
});

describe('useCreatePlaylistFlow', () => {
  it('creates the playlist, adds the tracks, toasts and navigates to it', async () => {
    const { result } = renderHook(() => useCreatePlaylistFlow(), { wrapper });
    const tracks = [makeTrack('t1'), makeTrack('t2')];

    await act(async () => { await result.current.handleCreate('Road Trip', tracks); });

    expect(api.createPlaylist).toHaveBeenCalledWith('Road Trip');
    expect(api.addToPlaylist).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledWith('Created "Road Trip" with 2 tracks');
    expect(router.push).toHaveBeenCalledWith('/playlist/p1');
  });

  it('toasts without a track count when created empty', async () => {
    const { result } = renderHook(() => useCreatePlaylistFlow(), { wrapper });

    await act(async () => { await result.current.handleCreate('Road Trip', []); });

    expect(toast.success).toHaveBeenCalledWith('Created "Road Trip"');
    expect(api.addToPlaylist).not.toHaveBeenCalled();
  });

  it('calls onCreated only after a successful create, before navigating', async () => {
    const onCreated = vi.fn();
    const { result } = renderHook(() => useCreatePlaylistFlow(onCreated), { wrapper });

    await act(async () => { await result.current.handleCreate('Road Trip', []); });

    expect(onCreated).toHaveBeenCalledTimes(1);
    // onCreated (Drawer's close()) runs before the navigation, matching the
    // original inline ordering: toast, close, then push.
    expect(onCreated.mock.invocationCallOrder[0]).toBeLessThan(router.push.mock.invocationCallOrder[0]);
  });

  it('toasts an error and does not navigate or call onCreated when creation fails', async () => {
    api.createPlaylist.mockRejectedValue(new Error('network down'));
    const onCreated = vi.fn();
    const { result } = renderHook(() => useCreatePlaylistFlow(onCreated), { wrapper });

    await act(async () => { await result.current.handleCreate('Road Trip', []); });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't create playlist: network down"));
    expect(router.push).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('starts with the create dialog closed and exposes a setter', () => {
    const { result } = renderHook(() => useCreatePlaylistFlow(), { wrapper });
    expect(result.current.createOpen).toBe(false);
    act(() => result.current.setCreateOpen(true));
    expect(result.current.createOpen).toBe(true);
  });
});
