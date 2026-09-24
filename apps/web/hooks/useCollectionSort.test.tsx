import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { DEFAULT_LIKED_SORT, DEFAULT_PLAYLIST_SORT } from '@/lib/playlistCopy';
import { resetCollectionSortMemory, useCollectionSort } from './useCollectionSort';

beforeEach(() => {
  resetCollectionSortMemory();
  window.localStorage.clear();
});

afterEach(() => vi.restoreAllMocks());

describe('useCollectionSort', () => {
  it('starts on the default for the kind of collection', () => {
    expect(renderHook(() => useCollectionSort('playlist:p1', DEFAULT_PLAYLIST_SORT)).result.current[0]).toEqual({ key: 'added', dir: 'asc' });
    expect(renderHook(() => useCollectionSort('liked', DEFAULT_LIKED_SORT)).result.current[0]).toEqual({ key: 'added', dir: 'desc' });
  });

  it('remembers the choice per collection on the device', () => {
    const one = renderHook(() => useCollectionSort('playlist:p1', DEFAULT_PLAYLIST_SORT));
    act(() => one.result.current[1]({ key: 'title', dir: 'desc' }));
    expect(one.result.current[0]).toEqual({ key: 'title', dir: 'desc' });
    expect(JSON.parse(window.localStorage.getItem('ember-sort:playlist:p1')!)).toEqual({ key: 'title', dir: 'desc' });

    // Another playlist keeps its own.
    expect(renderHook(() => useCollectionSort('playlist:p2', DEFAULT_PLAYLIST_SORT)).result.current[0]).toEqual(DEFAULT_PLAYLIST_SORT);

    // A fresh page load (memory gone) reads it back from storage.
    one.unmount();
    resetCollectionSortMemory();
    expect(renderHook(() => useCollectionSort('playlist:p1', DEFAULT_PLAYLIST_SORT)).result.current[0]).toEqual({ key: 'title', dir: 'desc' });
  });

  it('ignores a stored value it does not understand', () => {
    window.localStorage.setItem('ember-sort:liked', '{"key":"plays","dir":"asc"}');
    expect(renderHook(() => useCollectionSort('liked', DEFAULT_LIKED_SORT)).result.current[0]).toEqual(DEFAULT_LIKED_SORT);
    window.localStorage.setItem('ember-sort:liked', 'not json');
    resetCollectionSortMemory();
    expect(renderHook(() => useCollectionSort('liked', DEFAULT_LIKED_SORT)).result.current[0]).toEqual(DEFAULT_LIKED_SORT);
  });

  it('still sorts with storage off', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const { result } = renderHook(() => useCollectionSort('playlist:p9', DEFAULT_PLAYLIST_SORT));
    expect(result.current[0]).toEqual(DEFAULT_PLAYLIST_SORT);
    act(() => result.current[1]({ key: 'duration', dir: 'asc' }));
    expect(result.current[0]).toEqual({ key: 'duration', dir: 'asc' });
  });
});
