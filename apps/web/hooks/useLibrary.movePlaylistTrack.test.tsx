/** Move up / down in a playlist: the row moves in the cache at once, the
 *  server is told the new place, and a refusal puts it back. */
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { QK, useExecuteMovePlaylistTrack, useQueryPlaylist, COLLAB_POLL_MS } from './useLibrary';

vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
const api = vi.hoisted(() => ({ movePlaylistTrack: vi.fn(), getPlaylist: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

const row = (id: string) => ({ id, title: id }) as never;
const data = { playlist: { id: 'pl', name: 'Trip' }, tracks: ['a', 'b', 'c'].map(row) };

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  client.setQueryData(QK.playlist('pl'), data);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}
const order = (client: QueryClient) =>
  (client.getQueryData(QK.playlist('pl')) as typeof data).tracks.map((t: { id: string }) => t.id);

describe('useExecuteMovePlaylistTrack', () => {
  it('moves the row at once and asks the server for the new place', async () => {
    let finish!: (v: unknown) => void;
    api.movePlaylistTrack.mockReturnValueOnce(new Promise((r) => (finish = r)));
    api.getPlaylist.mockResolvedValue({ ...data, tracks: ['c', 'a', 'b'].map(row) });
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useExecuteMovePlaylistTrack(), { wrapper });
    let done!: Promise<unknown>;
    act(() => {
      done = result.current.mutateAsync({ id: 'pl', trackId: 'c', from: 2, to: 0 });
    });
    await vi.waitFor(() => expect(order(client)).toEqual(['c', 'a', 'b']));
    expect(api.movePlaylistTrack).toHaveBeenCalledWith('pl', 'c', 0);
    await act(async () => {
      finish({ ok: true });
      await done;
    });
  });

  it('puts it back when the server refuses', async () => {
    api.movePlaylistTrack.mockRejectedValueOnce(Object.assign(new Error('gone'), { status: 404 }));
    api.getPlaylist.mockResolvedValue(data);
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useExecuteMovePlaylistTrack(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'pl', trackId: 'a', from: 0, to: 1 }).catch(() => {});
    });
    expect(order(client)).toEqual(['a', 'b', 'c']);
  });
});

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
