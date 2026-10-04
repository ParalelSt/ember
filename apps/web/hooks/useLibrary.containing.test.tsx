import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { QK, useExecuteBulkAddToPlaylist, useExecuteDeletePlaylist, useExecuteReplaceInPlaylist } from './useLibrary';
import type { Track } from '@/types/track';

/** The Add to playlist menu marks the playlists a song is already in
 *  (QK.containing). Every change to which playlists hold which songs must
 *  drop those marks, or the menu says a song is not in a playlist it was
 *  just copied to (and adding it again is refused as a duplicate). */
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
const api = vi.hoisted(() => ({
  bulkAddToPlaylist: vi.fn(async () => ({ added: 1, skipped: [] })),
  replaceInPlaylist: vi.fn(async () => ({ ok: true })),
  deletePlaylist: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/api', () => ({ api }));

const track = { id: 't1' } as Track;

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(QK.containing('t1'), ['other']);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const stale = () => client.getQueryState(QK.containing('t1'))?.isInvalidated;
  return { client, wrapper, stale };
}

describe('the "already in" marks after a playlist change', () => {
  it('a copy of songs into a playlist drops them', async () => {
    const { wrapper, stale } = setup();
    const { result } = renderHook(() => useExecuteBulkAddToPlaylist(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ id: 'p1', tracks: [track] }); });
    expect(stale()).toBe(true);
  });

  it('a replaced song drops them', async () => {
    const { wrapper, stale } = setup();
    const { result } = renderHook(() => useExecuteReplaceInPlaylist(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ id: 'p1', trackId: 't0', track }); });
    expect(stale()).toBe(true);
  });

  it('a deleted playlist drops them', async () => {
    const { wrapper, stale } = setup();
    const { result } = renderHook(() => useExecuteDeletePlaylist(), { wrapper });
    await act(async () => { await result.current.mutateAsync('p1'); });
    expect(stale()).toBe(true);
  });
});
