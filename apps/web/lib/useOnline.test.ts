import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useOnline } from './useOnline';

/** A page opened after the connection dropped (Library, Liked songs from
 *  the menu) started as online and waited the 2 s settle before it knew:
 *  meanwhile its queries were paused, so it showed "Nothing liked yet" or
 *  the online library before the offline view. */

const setOnLine = (v: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => v });

afterEach(() => {
  act(() => {
    setOnLine(true);
    window.dispatchEvent(new Event('online'));
  });
  vi.useRealTimers();
});

describe('useOnline', () => {
  it('a fresh page load starts optimistic and settles after 2 s', () => {
    vi.useFakeTimers();
    setOnLine(false);
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current).toBe(false);
  });

  it('a page opened after the offline event knows at once', () => {
    const first = renderHook(() => useOnline());
    act(() => {
      setOnLine(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(first.result.current).toBe(false);
    const later = renderHook(() => useOnline());
    expect(later.result.current).toBe(false);
  });

  it('and once back online, a page opened then is online at once', () => {
    renderHook(() => useOnline());
    act(() => {
      setOnLine(false);
      window.dispatchEvent(new Event('offline'));
    });
    act(() => {
      setOnLine(true);
      window.dispatchEvent(new Event('online'));
    });
    const later = renderHook(() => useOnline());
    expect(later.result.current).toBe(true);
  });
});
