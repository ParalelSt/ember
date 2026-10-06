/** Edit order's Done: the new order lands in the cache at once, the server
 *  gets the fewest single moves that make it, and a refusal puts it back. */
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { QK, useExecuteReorderPlaylist } from './useLibrary';

vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
const api = vi.hoisted(() => ({ movePlaylistTrack: vi.fn(), getPlaylist: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

const row = (id: string) => ({ id, title: id }) as never;
const data = (ids: string[]) => ({ playlist: { id: 'pl', name: 'Trip' }, tracks: ids.map(row) });

function setup(ids = ['a', 'b', 'c', 'd']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  client.setQueryData(QK.playlist('pl'), data(ids));
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}
const order = (client: QueryClient) =>
  (client.getQueryData(QK.playlist('pl')) as ReturnType<typeof data>).tracks.map((t: { id: string }) => t.id);

beforeEach(() => vi.clearAllMocks());

describe('useExecuteReorderPlaylist', () => {
  it('shows the new order at once and sends one move per song out of place, in turn', async () => {
    const sent: string[] = [];
    api.movePlaylistTrack.mockImplementation(async (_id: string, trackId: string, to: number) => {
      sent.push(`${trackId}->${to}`);
      return { ok: true };
    });
    api.getPlaylist.mockResolvedValue(data(['d', 'a', 'c', 'b']));
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useExecuteReorderPlaylist(), { wrapper });
    let done!: Promise<unknown>;
    act(() => {
      done = result.current.mutateAsync({ id: 'pl', order: ['d', 'a', 'c', 'b'] });
    });
    await vi.waitFor(() => expect(order(client)).toEqual(['d', 'a', 'c', 'b']));
    await act(async () => {
      await done;
    });
    expect(sent).toHaveLength(2);
    expect(api.movePlaylistTrack).toHaveBeenCalledWith('pl', 'd', 0);
  });

  it('a song someone else added meanwhile stays, at the end; one they removed is skipped', async () => {
    api.movePlaylistTrack.mockResolvedValue({ ok: true });
    api.getPlaylist.mockResolvedValue(data(['b', 'a', 'e']));
    const { client, wrapper } = setup(['a', 'b', 'e']);
    const { result } = renderHook(() => useExecuteReorderPlaylist(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'pl', order: ['b', 'a', 'gone'] });
    });
    expect(api.movePlaylistTrack).toHaveBeenCalledTimes(1);
    expect(order(client)).toEqual(['b', 'a', 'e']);
  });

  it('nothing changed: no request', async () => {
    api.getPlaylist.mockResolvedValue(data(['a', 'b', 'c', 'd']));
    const { wrapper } = setup();
    const { result } = renderHook(() => useExecuteReorderPlaylist(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'pl', order: ['a', 'b', 'c', 'd'] });
    });
    expect(api.movePlaylistTrack).not.toHaveBeenCalled();
  });

  it('a refusal puts the old order back and fails', async () => {
    api.movePlaylistTrack.mockRejectedValueOnce(Object.assign(new Error('gone'), { status: 404 }));
    api.getPlaylist.mockResolvedValue(data(['a', 'b', 'c', 'd']));
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useExecuteReorderPlaylist(), { wrapper });
    let failed = false;
    await act(async () => {
      await result.current.mutateAsync({ id: 'pl', order: ['b', 'a', 'c', 'd'] }).catch(() => (failed = true));
    });
    expect(failed).toBe(true);
    expect(order(client)).toEqual(['a', 'b', 'c', 'd']);
  });
});
