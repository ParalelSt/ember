import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { useSaveAsPlaylist } from './useSaveAsPlaylist';
import type { Track } from '@/types/track';

const api = vi.hoisted(() => ({
  createPlaylist: vi.fn(),
  bulkAddToPlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api }));

const song = { id: 'youtube:a', source: 'youtube', sourceId: 'a', title: 'A', artist: 'X' } as Track;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.createPlaylist.mockResolvedValue({ playlist: { id: 'p1', name: 'Mix' } });
  api.bulkAddToPlaylist.mockResolvedValue({ added: 1, skipped: [] });
  api.deletePlaylist.mockResolvedValue({ ok: true });
});

describe('useSaveAsPlaylist', () => {
  it('makes the playlist with the songs', async () => {
    const { result } = renderHook(() => useSaveAsPlaylist(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ name: 'Mix', tracks: [song] });
    });
    expect(api.bulkAddToPlaylist).toHaveBeenCalledWith('p1', [song]);
    expect(api.deletePlaylist).not.toHaveBeenCalled();
  });

  it('songs that could not go in leave no empty playlist behind, so Try again makes only one', async () => {
    api.bulkAddToPlaylist.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useSaveAsPlaylist(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ name: 'Mix', tracks: [song] })).rejects.toThrow('offline');
    });
    expect(api.deletePlaylist).toHaveBeenCalledWith('p1');
  });
});
