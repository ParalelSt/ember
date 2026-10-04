import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useImportReview } from './useImportReview';
import type { Track } from '@/types/track';

vi.mock('@/components/player/PlayerProvider', () => ({
  usePlayer: () => ({ current: null, isPlaying: false, playTrack: vi.fn(), toggle: vi.fn() }),
}));
const api = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

const yt = (id: string): Track => ({
  id: `youtube:${id}`, source: 'youtube', sourceId: id, title: id, artist: 'A', artistId: null,
  album: null, albumId: null, durationSec: 100, artworkUrl: null, streamUrl: '',
});

/** A search the test answers by hand. */
function pending() {
  let resolve!: (tracks: Track[]) => void;
  const promise = new Promise<{ tracks: Track[] }>((r) => { resolve = (tracks) => r({ tracks }); });
  return { promise, resolve };
}

beforeEach(() => api.search.mockReset());

describe('useImportReview: the "none of these" search', () => {
  it('drops an answer for the song the sheet has already moved past', async () => {
    const slow = pending();
    api.search.mockReturnValueOnce(slow.promise);
    const { result } = renderHook(() => useImportReview([]));
    act(() => result.current.onSearch('song one'));
    // "Use best match" on song one moves on to song two.
    act(() => result.current.advance());
    await act(async () => { slow.resolve([yt('songOneVideo')]); await slow.promise; });
    expect(result.current.searchResults).toBeNull();
    expect(result.current.searching).toBe(false);
  });

  it('keeps the newest search when an older one answers last', async () => {
    const older = pending();
    const newer = pending();
    api.search.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const { result } = renderHook(() => useImportReview([]));
    act(() => result.current.onSearch('first try'));
    act(() => result.current.onSearch('second try'));
    await act(async () => { newer.resolve([yt('newer')]); await newer.promise; });
    expect(result.current.searching).toBe(false);
    await act(async () => { older.resolve([yt('older')]); await older.promise; });
    expect(result.current.searchResults?.map((t) => t.sourceId)).toEqual(['newer']);
  });

  it('is still searching while the newest search is on its way', async () => {
    const older = pending();
    const newer = pending();
    api.search.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const { result } = renderHook(() => useImportReview([]));
    act(() => result.current.onSearch('first try'));
    act(() => result.current.onSearch('second try'));
    await act(async () => { older.resolve([yt('older')]); await older.promise; });
    expect(result.current.searching).toBe(true);
    expect(result.current.searchResults).toBeNull();
  });
});
