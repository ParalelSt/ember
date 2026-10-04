import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useTabAlignment } from './useTabSources';
import type { TabSummary } from '@/lib/tabSources';

const api = vi.hoisted(() => ({ getTabAlignment: vi.fn(), lineTabUp: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));
vi.mock('@/hooks/useLibrary', () => ({ QK: {}, useQueryTrack: () => ({ data: null }) }));

const tab = (id: string) => ({ id, timing: null }) as unknown as TabSummary;

function pending<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api.getTabAlignment.mockReset().mockResolvedValue({ status: 'none' });
  api.lineTabUp.mockReset();
});

describe('useTabAlignment: Line it up', () => {
  it('marks the tab it was pressed for as running, even after switching to another tab', async () => {
    const req = pending<{ status: 'running' }>();
    api.lineTabUp.mockReturnValueOnce(req.promise);
    const { result, rerender } = renderHook(({ t }) => useTabAlignment(t), { wrapper, initialProps: { t: tab('A') } });
    await waitFor(() => expect(api.getTabAlignment).toHaveBeenCalledWith('A'));
    act(() => result.current.lineUp());
    rerender({ t: tab('B') });
    // The other tab is not the one lining up.
    await waitFor(() => expect(api.getTabAlignment).toHaveBeenCalledWith('B'));
    expect(result.current.running).toBe(false);
    await act(async () => { req.resolve({ status: 'running' }); await req.promise; });
    expect(client.getQueryData(['tab-align', 'B'])).toEqual({ status: 'none' });
    expect(client.getQueryData(['tab-align', 'A'])).toEqual({ status: 'running' });
  });

  it('an older status answer that lands after the press does not undo "running"', async () => {
    const { result } = renderHook(() => useTabAlignment(tab('A')), { wrapper });
    await waitFor(() => expect(result.current.running).toBe(false));
    // A refetch is on its way with the status from before the press.
    const stale = pending<{ status: 'none' }>();
    api.getTabAlignment.mockReturnValueOnce(stale.promise);
    act(() => { void client.refetchQueries({ queryKey: ['tab-align', 'A'] }); });
    api.lineTabUp.mockResolvedValueOnce({ status: 'running' });
    api.getTabAlignment.mockResolvedValue({ status: 'running' });
    await act(async () => { result.current.lineUp(); });
    await waitFor(() => expect(client.getQueryData(['tab-align', 'A'])).toEqual({ status: 'running' }));
    await act(async () => { stale.resolve({ status: 'none' }); await stale.promise; });
    expect(client.getQueryData(['tab-align', 'A'])).toEqual({ status: 'running' });
    expect(result.current.running).toBe(true);
  });
});
