/** The Download button's message for a browser-storage download that skipped
 *  some tracks (bughunt P09): it says how many could not be saved instead of
 *  failing the whole playlist. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { makeTrack } from '@/test-utils/fakeBackend';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const downloadPlaylist = vi.hoisted(() => vi.fn());
vi.mock('@/lib/offline', () => ({
  downloadPlaylist,
  cancelDownload: vi.fn(),
  isStale: vi.fn().mockResolvedValue(false),
  pinList: vi.fn(),
  playableFor: (t: unknown[]) => t,
  removeDownload: vi.fn(),
}));

import { useOfflinePin } from './useOfflinePin';

const tracks = Array.from({ length: 40 }, (_, i) => makeTrack({ id: `youtube:t${i}` }));

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { getDirectory: vi.fn() } });
});

describe('useOfflinePin (browser storage)', () => {
  it('says how many tracks could not be saved', async () => {
    downloadPlaylist.mockResolvedValue({ saved: 37, failed: 3 });
    const { result } = renderHook(() => useOfflinePin({ kind: 'playlist', id: 'pl1' }, 'Mix', tracks));

    await act(() => result.current!.onDownload());

    expect(toast.success).toHaveBeenCalledWith('Downloaded "Mix", 3 of 40 couldn\'t be saved');
  });

  it('says plain Downloaded when every track was saved', async () => {
    downloadPlaylist.mockResolvedValue({ saved: 40, failed: 0 });
    const { result } = renderHook(() => useOfflinePin({ kind: 'playlist', id: 'pl1' }, 'Mix', tracks));

    await act(() => result.current!.onDownload());

    expect(toast.success).toHaveBeenCalledWith('Downloaded "Mix"');
  });
});
