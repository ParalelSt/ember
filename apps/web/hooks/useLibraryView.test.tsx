import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { LIBRARY_VIEW_KEY } from '@/lib/library';
import { resetLibraryViewMemory, useLibraryView } from './useLibraryView';

beforeEach(() => {
  localStorage.clear();
  resetLibraryViewMemory();
});
afterEach(() => vi.restoreAllMocks());

describe('useLibraryView', () => {
  it('starts as a grid and remembers a list on this device', () => {
    const first = renderHook(() => useLibraryView());
    expect(first.result.current[0]).toBe('grid');
    act(() => first.result.current[1]('list'));
    expect(first.result.current[0]).toBe('list');
    expect(localStorage.getItem(LIBRARY_VIEW_KEY)).toBe('list');
    first.unmount();
    resetLibraryViewMemory();
    expect(renderHook(() => useLibraryView()).result.current[0]).toBe('list');
  });

  it('every open copy follows a change', () => {
    const a = renderHook(() => useLibraryView());
    const b = renderHook(() => useLibraryView());
    act(() => a.result.current[1]('list'));
    expect(b.result.current[0]).toBe('list');
  });

  it('still toggles where storage is blocked, just without remembering', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useLibraryView());
    act(() => result.current[1]('list'));
    expect(result.current[0]).toBe('list');
  });

  it('the server renders the grid, whatever was saved', () => {
    localStorage.setItem(LIBRARY_VIEW_KEY, 'list');
    function Probe() {
      return <span>{useLibraryView()[0]}</span>;
    }
    expect(renderToString(<Probe />)).toContain('grid');
  });
});
