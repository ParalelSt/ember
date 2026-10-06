/** A collaborative playlist polls the server every few seconds. A poll that
 *  goes out while your own reorder or removal is still on its way reads the
 *  order from before it, and must not put that old order back over the row
 *  you just moved (the list "jumped back" until the next answer). Once the
 *  edit is done, polls show everyone's changes again. */
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { QK, useExecuteReorderPlaylist, useExecuteRemoveFromPlaylist, useQueryPlaylist } from './useLibrary';

vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
const api = vi.hoisted(() => ({ movePlaylistTrack: vi.fn(), removeFromPlaylist: vi.fn(), getPlaylist: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

const row = (id: string) => ({ id, title: id }) as never;
const answer = (ids: string[]) => ({ playlist: { id: 'pl', name: 'Trip', collaborative: true }, tracks: ids.map(row) });

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(QK.playlist('pl'), answer(['a', 'b', 'c']));
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}
const order = (client: QueryClient) =>
  (client.getQueryData(QK.playlist('pl')) as ReturnType<typeof answer>).tracks.map((t: { id: string }) => t.id);
/** What the interval does: fetch the open playlist again. */
const poll = (client: QueryClient) => act(() => client.refetchQueries({ queryKey: QK.playlist('pl') }));

describe('a poll while your own edit is on its way', () => {
  it('does not move the row back while the move is pending, then follows the server', async () => {
    let server = ['a', 'b', 'c'];
    api.getPlaylist.mockReset().mockImplementation(async () => answer(server));
    let finish!: (v: unknown) => void;
    api.movePlaylistTrack.mockReset().mockReturnValueOnce(new Promise((r) => (finish = r)));
    const { client, wrapper } = setup();
    const { result } = renderHook(() => ({ list: useQueryPlaylist('pl'), move: useExecuteReorderPlaylist() }), { wrapper });

    let done!: Promise<unknown>;
    act(() => {
      done = result.current.move.mutateAsync({ id: 'pl', order: ['a', 'c', 'b'] });
    });
    await vi.waitFor(() => expect(order(client)).toEqual(['a', 'c', 'b']));

    // The poll reads the server before the move has landed there.
    await poll(client);
    expect(api.getPlaylist).toHaveBeenCalled();
    expect(order(client)).toEqual(['a', 'c', 'b']);

    // The move lands; the refetch after it, and later polls, show the server.
    server = ['a', 'c', 'b'];
    await act(async () => {
      finish({ ok: true });
      await done;
    });
    expect(order(client)).toEqual(['a', 'c', 'b']);
    server = ['a', 'c', 'b', 'd'];
    await poll(client);
    expect(order(client)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('does not bring a removed song back while the removal is pending', async () => {
    let server = ['a', 'b', 'c'];
    api.getPlaylist.mockReset().mockImplementation(async () => answer(server));
    let finish!: (v: unknown) => void;
    api.removeFromPlaylist.mockReset().mockReturnValueOnce(new Promise((r) => (finish = r)));
    const { client, wrapper } = setup();
    const { result } = renderHook(() => ({ list: useQueryPlaylist('pl'), remove: useExecuteRemoveFromPlaylist() }), { wrapper });

    let done!: Promise<unknown>;
    act(() => {
      done = result.current.remove.mutateAsync({ id: 'pl', trackId: 'b' });
    });
    await vi.waitFor(() => expect(order(client)).toEqual(['a', 'c']));
    await poll(client);
    expect(order(client)).toEqual(['a', 'c']);

    server = ['a', 'c'];
    await act(async () => {
      finish({});
      await done;
    });
    server = ['a', 'c', 'e'];
    await poll(client);
    expect(order(client)).toEqual(['a', 'c', 'e']);
  });

  it('a refused move still goes back to the server order', async () => {
    api.getPlaylist.mockReset().mockImplementation(async () => answer(['a', 'b', 'c']));
    api.movePlaylistTrack.mockReset().mockRejectedValueOnce(Object.assign(new Error('gone'), { status: 404 }));
    const { client, wrapper } = setup();
    const { result } = renderHook(() => ({ list: useQueryPlaylist('pl'), move: useExecuteReorderPlaylist() }), { wrapper });
    await act(async () => {
      await result.current.move.mutateAsync({ id: 'pl', order: ['a', 'c', 'b'] }).catch(() => {});
    });
    expect(order(client)).toEqual(['a', 'b', 'c']);
    await poll(client);
    expect(order(client)).toEqual(['a', 'b', 'c']);
  });
});
