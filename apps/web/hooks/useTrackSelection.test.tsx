import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Track } from '@/types/track';
import { useTrackSelection } from './useTrackSelection';

function t(id: string, title = id): Track {
  return { id, source: 'youtube', sourceId: id, title, artist: 'A', artistId: null, album: null, albumId: null, durationSec: 100, artworkUrl: null, streamUrl: '' };
}

const A = t('a');
const B = t('b');
const C = t('c');

describe('useTrackSelection', () => {
  it('starts off, enters select mode, and toggles one song at a time', () => {
    const { result } = renderHook(() => useTrackSelection([A, B, C]));
    expect(result.current.selecting).toBe(false);
    act(() => result.current.enter());
    expect(result.current.selecting).toBe(true);
    act(() => result.current.toggle('b'));
    act(() => result.current.toggle('a'));
    expect(result.current.isSelected('a')).toBe(true);
    expect(result.current.count).toBe(2);
    // In list order, not the order they were ticked.
    expect(result.current.picked).toEqual([A, B]);
    act(() => result.current.toggle('a'));
    expect(result.current.picked).toEqual([B]);
  });

  it('select all, the tri-state, and select all again clears', () => {
    const { result } = renderHook(() => useTrackSelection([A, B, C]));
    expect(result.current.allState).toBe(false);
    act(() => result.current.toggle('a'));
    expect(result.current.allState).toBe('mixed');
    act(() => result.current.toggleAll());
    expect(result.current.allState).toBe(true);
    expect(result.current.count).toBe(3);
    act(() => result.current.toggleAll());
    expect(result.current.count).toBe(0);
    expect(result.current.allState).toBe(false);
  });

  it('clear keeps select mode on; exit leaves it and forgets the picks', () => {
    const { result } = renderHook(() => useTrackSelection([A, B, C]));
    act(() => result.current.toggleAll());
    act(() => result.current.clear());
    expect(result.current.selecting).toBe(true);
    expect(result.current.count).toBe(0);
    act(() => result.current.toggle('c'));
    act(() => result.current.exit());
    expect(result.current.selecting).toBe(false);
    act(() => result.current.enter());
    expect(result.current.count).toBe(0);
  });

  it('survives a re-sort, and drops songs that left the list', () => {
    const { result, rerender } = renderHook(({ list }) => useTrackSelection(list), { initialProps: { list: [A, B, C] } });
    act(() => result.current.toggle('a'));
    act(() => result.current.toggle('c'));
    rerender({ list: [C, B, A] });
    expect(result.current.picked).toEqual([C, A]);
    rerender({ list: [B, A] });
    expect(result.current.picked).toEqual([A]);
    expect(result.current.allState).toBe('mixed');
    expect(result.current.total).toBe(2);
  });
});
