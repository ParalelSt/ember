import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useTabSources, type TabSong } from './useTabSources';

const api = vi.hoisted(() => ({
  getTrackTabs: vi.fn(),
  getTabs: vi.fn(),
  findTabsOnline: vi.fn(),
  lineTabUp: vi.fn(),
  getTabAlignment: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api }));
vi.mock('@/hooks/useLibrary', () => ({ QK: {}, useQueryTrack: () => ({ data: null }) }));

const song: TabSong = { id: 'upload:s1', title: 'Copper Sky', artist: 'Coastline', track: null };
const row = { id: 't1', kind: 'fetched', title: 'Copper Sky', artist: 'Coastline', timing: null };

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api.getTrackTabs.mockReset().mockResolvedValue({ tabs: [row] });
  api.getTabs.mockReset().mockResolvedValue({ matches: [] });
  api.findTabsOnline.mockReset().mockResolvedValue({ status: 'cached', searchedAt: null, added: 0 });
  api.lineTabUp.mockReset().mockResolvedValue({ status: 'running' });
  api.getTabAlignment.mockReset().mockResolvedValue({ status: 'running' });
});

describe('useTabSources: "Line it up" from the Source sheet', () => {
  it('stops showing "Lining it up" once the job has failed, instead of waiting six minutes', async () => {
    const { result } = renderHook(() => useTabSources(song), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { result.current.lineUp('t1'); });
    await waitFor(() => expect(api.lineTabUp).toHaveBeenCalledWith('t1'));
    expect(result.current.liningUp).toEqual(['t1']);

    // align.py could not do it: the row keeps its old timing.
    api.getTabAlignment.mockResolvedValue({ status: 'failed', error: 'that tab has too few notes to line up' });
    await act(async () => { await client.refetchQueries({ queryKey: ['tab-align', 't1'] }); });
    await waitFor(() => expect(result.current.liningUp).toEqual([]));
  });

  it('keeps waiting while the job is still running', async () => {
    const { result } = renderHook(() => useTabSources(song), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { result.current.lineUp('t1'); });
    await waitFor(() => expect(api.lineTabUp).toHaveBeenCalled());
    await act(async () => { await client.refetchQueries({ queryKey: ['tab-align', 't1'] }); });
    expect(result.current.liningUp).toEqual(['t1']);
  });
});
