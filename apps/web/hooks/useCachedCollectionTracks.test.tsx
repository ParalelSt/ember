import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { QK, useCachedCollectionTracks } from './useLibrary';

vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

describe('useCachedCollectionTracks', () => {
  it('observes existing song data and updates without starting any requests', async () => {
    const queryFn = vi.fn(async () => []);
    const client = new QueryClient({ defaultOptions: { queries: { queryFn, retry: false } } });
    const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result, unmount } = renderHook(() => useCachedCollectionTracks(), { wrapper });
    expect(result.current).toEqual({ heart: undefined, clock: undefined, upload: undefined });
    act(() => {
      client.setQueryData(QK.likes, []);
      client.setQueryData(QK.history, [{ artworkUrl: '/recent' }]);
      client.setQueryData(QK.uploads, [{ artworkUrl: '/upload' }]);
    });
    await waitFor(() => expect(result.current.clock).toEqual([{ artworkUrl: '/recent' }]));
    expect(result.current.heart).toEqual([]);
    expect(result.current.upload).toEqual([{ artworkUrl: '/upload' }]);
    await client.invalidateQueries();
    expect(queryFn).not.toHaveBeenCalled();
    expect(client.isFetching()).toBe(0);
    unmount();
    client.clear();
  });
});
