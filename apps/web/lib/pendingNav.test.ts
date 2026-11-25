import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { PENDING_NAV_MS, cancelPendingNav, resetPendingNav, startPendingNav, usePendingNav } from './pendingNav';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  resetPendingNav();
  vi.useRealTimers();
});

describe('pendingNav', () => {
  it('reports the tapped href while still on the page the tap left', () => {
    const { result } = renderHook(() => usePendingNav('/'));
    expect(result.current).toBeNull();
    act(() => startPendingNav('/radio', '/'));
    expect(result.current).toBe('/radio');
  });

  it('lets go when the route changes', () => {
    const { result, rerender } = renderHook(({ p }) => usePendingNav(p), { initialProps: { p: '/' } });
    act(() => startPendingNav('/radio', '/'));
    rerender({ p: '/radio' });
    expect(result.current).toBeNull();
  });

  it('lets go after 10 seconds', () => {
    const { result } = renderHook(() => usePendingNav('/'));
    act(() => startPendingNav('/radio', '/'));
    act(() => void vi.advanceTimersByTime(PENDING_NAV_MS - 1));
    expect(result.current).toBe('/radio');
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBeNull();
  });

  it('ignores a tap on the page we are already on', () => {
    const { result } = renderHook(() => usePendingNav('/'));
    act(() => startPendingNav('/', '/'));
    expect(result.current).toBeNull();
  });

  it('cancel clears only the matching target', () => {
    const { result } = renderHook(() => usePendingNav('/'));
    act(() => startPendingNav('/radio', '/'));
    act(() => cancelPendingNav('/library'));
    expect(result.current).toBe('/radio');
    act(() => cancelPendingNav('/radio'));
    expect(result.current).toBeNull();
  });

  it('a newer tap replaces the older one', () => {
    const { result } = renderHook(() => usePendingNav('/'));
    act(() => startPendingNav('/radio', '/'));
    act(() => startPendingNav('/library', '/'));
    expect(result.current).toBe('/library');
  });
});
