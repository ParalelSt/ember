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
  deleteTabFile: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api }));
vi.mock('@/hooks/useLibrary', () => ({ QK: {}, useQueryTrack: () => ({ data: null }) }));
const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const song: TabSong = { id: 'upload:s1', title: 'Copper Sky', artist: 'Coastline', track: null };
const row = { id: 't1', kind: 'file', title: 'Copper Sky', artist: 'Coastline', timing: null };

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  toast.error.mockReset();
  api.getTrackTabs.mockReset().mockResolvedValue({ tabs: [row] });
  api.getTabs.mockReset().mockResolvedValue({ matches: [] });
  api.findTabsOnline.mockReset().mockResolvedValue({ status: 'cached', searchedAt: null, added: 0 });
  api.deleteTabFile.mockReset();
});

describe('useTabSources: deleting a tab', () => {
  // "Delete this tab for everyone?" then nothing: the tab stayed with no word why.
  it('says so when the delete fails', async () => {
    api.deleteTabFile.mockRejectedValue(Object.assign(new Error('Only whoever added this tab can delete it.'), { status: 403 }));
    const { result } = renderHook(() => useTabSources(song), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { result.current.remove('t1'); });
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error.mock.calls[0][0]).toMatch(/delete/i);
  });

  it('stays quiet when it works', async () => {
    api.deleteTabFile.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useTabSources(song), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { result.current.remove('t1'); });
    await waitFor(() => expect(api.deleteTabFile).toHaveBeenCalledWith('t1'));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
