/** A collaborative playlist's page follows other people's changes. */
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { useQueryPlaylist, COLLAB_POLL_MS } from './useLibrary';

vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
const api = vi.hoisted(() => ({ getPlaylist: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

const row = (id: string) => ({ id, title: id }) as never;
const data = { playlist: { id: 'pl', name: 'Trip' }, tracks: ['a', 'b', 'c'].map(row) };

describe('useQueryPlaylist polling', () => {
  it('follows a collaborative playlist, not a private one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      for (const [collaborative, calls] of [[true, 2], [false, 1]] as const) {
        api.getPlaylist.mockReset();
        api.getPlaylist.mockResolvedValue({ ...data, playlist: { ...data.playlist, collaborative } });
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
        const { unmount } = renderHook(() => useQueryPlaylist('pl'), { wrapper });
        await vi.waitFor(() => expect(api.getPlaylist).toHaveBeenCalledTimes(1));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(COLLAB_POLL_MS + 100);
        });
        expect(api.getPlaylist).toHaveBeenCalledTimes(calls);
        unmount();
        client.clear();
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
