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
  it('starts as a list and remembers a grid on this device', () => {
    const first = renderHook(() => useLibraryView());
    expect(first.result.current[0]).toBe('list');
    act(() => first.result.current[1]('grid'));
    expect(first.result.current[0]).toBe('grid');
    expect(localStorage.getItem(LIBRARY_VIEW_KEY)).toBe('grid');
    first.unmount();
    resetLibraryViewMemory();
    expect(renderHook(() => useLibraryView()).result.current[0]).toBe('grid');
  });

  it('every open copy follows a change', () => {
    const a = renderHook(() => useLibraryView());
    const b = renderHook(() => useLibraryView());
    act(() => a.result.current[1]('grid'));
    expect(b.result.current[0]).toBe('grid');
  });

  it('still toggles where storage is blocked, just without remembering', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useLibraryView());
    act(() => result.current[1]('grid'));
    expect(result.current[0]).toBe('grid');
  });

  it('the server renders the list, whatever was saved', () => {
    localStorage.setItem(LIBRARY_VIEW_KEY, 'grid');
    function Probe() {
      return <span>{useLibraryView()[0]}</span>;
    }
    expect(renderToString(<Probe />)).toContain('list');
  });
});
