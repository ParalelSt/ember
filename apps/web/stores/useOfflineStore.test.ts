import { describe, expect, it, beforeEach } from 'vitest';
import { useOfflineStore } from './useOfflineStore';
import type { NativeStatus } from '@/lib/offlineNative';

function status(overrides: Partial<NativeStatus> = {}): NativeStatus {
  return {
    pins: [],
    trackFiles: {},
    totalBytes: 0,
    ...overrides,
  };
}

describe('useOfflineStore.setNativeStatus', () => {
  beforeEach(() => {
    useOfflineStore.setState({ pins: [], trackFiles: {}, artFiles: {}, downloaded: [], inFlight: {}, totalBytes: 0 });
  });

  it('carries artFiles from the plugin status into the store', () => {
    useOfflineStore.getState().setNativeStatus(status({ artFiles: { t1: '/data/art/t1.jpg' } }));
    expect(useOfflineStore.getState().artFiles).toEqual({ t1: '/data/art/t1.jpg' });
  });

  it('defaults artFiles to {} when the plugin status omits it (older native build)', () => {
    const s = status();
    delete (s as { artFiles?: Record<string, string> }).artFiles;
    useOfflineStore.getState().setNativeStatus(s);
    expect(useOfflineStore.getState().artFiles).toEqual({});
  });

  it('still derives downloaded/inFlight from pins alongside artFiles', () => {
    useOfflineStore.getState().setNativeStatus(status({
      pins: [{ id: 'p1', name: 'P1', total: 2, done: 2, failed: 0, downloading: false, trackIds: ['a', 'b'] }],
      artFiles: { a: '/data/art/a.jpg' },
    }));
    const s = useOfflineStore.getState();
    expect(s.downloaded).toEqual(['p1']);
    expect(s.artFiles).toEqual({ a: '/data/art/a.jpg' });
  });
});
