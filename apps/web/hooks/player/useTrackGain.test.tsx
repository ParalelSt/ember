import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const getTrackGain = vi.fn<(id: string) => Promise<{ gainDb: number | null }>>();
vi.mock('@/lib/api', () => ({ api: { getTrackGain: (id: string) => getTrackGain(id) } }));

const { useTrackGain } = await import('./useTrackGain');
const { loadTrackGain, resetTrackGainsForTests } = await import('@/lib/playback/normalization');

const A = 'youtube:aaaaaaaaaaa';
const B = 'youtube:bbbbbbbbbbb';

beforeEach(() => {
  window.localStorage.clear();
  resetTrackGainsForTests();
  getTrackGain.mockReset();
});

describe('useTrackGain', () => {
  it('starts at 0 and takes the fetched gain when it arrives', async () => {
    getTrackGain.mockImplementation(async (id) => ({ gainDb: id === A ? -7 : null }));
    const { result } = renderHook(() => useTrackGain(A, null, true));
    expect(result.current).toBe(0);
    await waitFor(() => expect(result.current).toBe(-7));
  });

  it('a gain already known is there on the first render', async () => {
    getTrackGain.mockResolvedValue({ gainDb: 3 });
    await loadTrackGain(A);
    getTrackGain.mockClear();
    const { result } = renderHook(() => useTrackGain(A, null, true));
    expect(result.current).toBe(3);
    expect(getTrackGain).not.toHaveBeenCalled();
  });

  it('asks about the next song ahead of time, and uses it when it becomes current', async () => {
    getTrackGain.mockImplementation(async (id) => ({ gainDb: id === A ? -2 : -9 }));
    const { result, rerender } = renderHook(({ id, next }) => useTrackGain(id, next, true), {
      initialProps: { id: A, next: B as string | null },
    });
    await waitFor(() => expect(getTrackGain).toHaveBeenCalledWith(B));
    await waitFor(() => expect(result.current).toBe(-2));
    rerender({ id: B, next: null });
    expect(result.current).toBe(-9);
  });

  it('does not carry the last song\'s gain onto an unmeasured one', async () => {
    getTrackGain.mockImplementation(async (id) => ({ gainDb: id === A ? -8 : null }));
    const { result, rerender } = renderHook(({ id }) => useTrackGain(id, null, true), {
      initialProps: { id: A },
    });
    await waitFor(() => expect(result.current).toBe(-8));
    rerender({ id: B });
    expect(result.current).toBe(0);
    await act(async () => {});
    expect(result.current).toBe(0);
  });

  it('off: always 0 and never fetches', async () => {
    getTrackGain.mockResolvedValue({ gainDb: -7 });
    const { result } = renderHook(() => useTrackGain(A, B, false));
    await act(async () => {});
    expect(result.current).toBe(0);
    expect(getTrackGain).not.toHaveBeenCalled();
  });
});
