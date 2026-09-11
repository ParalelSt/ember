import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QK, useExecuteRecordPlay } from './useLibrary';
import { useOfflineStore } from '@/stores/useOfflineStore';
import { RECENT_PIN } from '@/lib/offline';
import type { Track } from '@/types/track';

const auth = vi.hoisted(() => ({ user: { id: 'u1' } as { id: string } | null }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => auth }));

const api = vi.hoisted(() => ({ recordPlay: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

// Native-only feature: stub the plugin presence check and the pin call, and
// spy on the latter the way useCollections.test.tsx does for offline hooks.
const nativeMock = vi.hoisted(() => ({ present: true }));
const pinListSpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/lib/offlineNative', () => ({ nativeOfflinePresent: () => nativeMock.present }));
vi.mock('@/lib/offline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/offline')>();
  return { ...actual, pinList: pinListSpy };
});

function makeTrack(id: string): Track {
  return {
    id,
    source: 'youtube',
    sourceId: id,
    title: `Track ${id}`,
    artist: 'Artist',
    artistId: null,
    album: null,
    albumId: null,
    durationSec: 100,
    artworkUrl: null,
    streamUrl: '',
  };
}

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  nativeMock.present = true;
  auth.user = { id: 'u1' };
  useOfflineStore.setState({ pins: [], trackFiles: {}, artFiles: {}, downloaded: [], inFlight: {}, totalBytes: 0 });
});

describe('useExecuteRecordPlay: Recently played pin re-sync', () => {
  it('re-pins Recently played after a play changes the history set', async () => {
    useOfflineStore.setState({
      pins: [{ id: RECENT_PIN, name: 'Recently played', total: 1, done: 1, failed: 0, downloading: false, trackIds: ['t1'] }],
    });
    api.recordPlay.mockResolvedValue({});
    const { result } = renderHook(() => ({ mutate: useExecuteRecordPlay(), qc: useQueryClient() }), { wrapper });
    act(() => { result.current.qc.setQueryData(QK.history, [makeTrack('t1')]); });

    await act(async () => { result.current.mutate.mutate(makeTrack('t2')); });

    await waitFor(() => expect(pinListSpy).toHaveBeenCalledTimes(1));
    expect(pinListSpy).toHaveBeenCalledWith(RECENT_PIN, 'Recently played', expect.arrayContaining([
      expect.objectContaining({ id: 't2' }),
      expect.objectContaining({ id: 't1' }),
    ]));
  });

  it('does not re-pin when the pinned set already matches (no drift-triggered restart)', async () => {
    // The pin already holds exactly what history will hold after this play:
    // t1 stays queryData's head via onMutate's own dedup, so re-recording it
    // changes nothing about the pinned id set.
    useOfflineStore.setState({
      pins: [{ id: RECENT_PIN, name: 'Recently played', total: 1, done: 1, failed: 0, downloading: false, trackIds: ['t1'] }],
    });
    api.recordPlay.mockResolvedValue({});
    const { result } = renderHook(() => ({ mutate: useExecuteRecordPlay(), qc: useQueryClient() }), { wrapper });
    act(() => { result.current.qc.setQueryData(QK.history, [makeTrack('t1')]); });

    await act(async () => { result.current.mutate.mutate(makeTrack('t1')); });

    await waitFor(() => expect(api.recordPlay).toHaveBeenCalled());
    expect(pinListSpy).not.toHaveBeenCalled();
  });

  it('does nothing when there is no native plugin', async () => {
    nativeMock.present = false;
    api.recordPlay.mockResolvedValue({});
    const { result } = renderHook(() => ({ mutate: useExecuteRecordPlay(), qc: useQueryClient() }), { wrapper });
    act(() => { result.current.qc.setQueryData(QK.history, [makeTrack('t1')]); });

    await act(async () => { result.current.mutate.mutate(makeTrack('t2')); });

    await waitFor(() => expect(api.recordPlay).toHaveBeenCalled());
    expect(pinListSpy).not.toHaveBeenCalled();
  });

  it('does nothing when Recently played is not pinned', async () => {
    api.recordPlay.mockResolvedValue({});
    const { result } = renderHook(() => ({ mutate: useExecuteRecordPlay(), qc: useQueryClient() }), { wrapper });
    act(() => { result.current.qc.setQueryData(QK.history, [makeTrack('t1')]); });

    await act(async () => { result.current.mutate.mutate(makeTrack('t2')); });

    await waitFor(() => expect(api.recordPlay).toHaveBeenCalled());
    expect(pinListSpy).not.toHaveBeenCalled();
  });
});
