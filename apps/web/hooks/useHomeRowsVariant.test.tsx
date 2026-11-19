import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHomeRowsVariant } from './useHomeRowsVariant';
import { HOME_ROWS_STORAGE_KEY } from '@/lib/homeRows';

afterEach(() => window.localStorage.clear());

describe('useHomeRowsVariant', () => {
  it('is today with no param and nothing saved', () => {
    const { result } = renderHook(() => useHomeRowsVariant(null));
    expect(result.current).toBe('today');
  });

  it('takes the ?homerows= param and saves it', () => {
    const { result } = renderHook(() => useHomeRowsVariant('b'));
    expect(result.current).toBe('b');
    expect(window.localStorage.getItem(HOME_ROWS_STORAGE_KEY)).toBe('b');
  });

  it('reads the saved pick when there is no param', () => {
    window.localStorage.setItem(HOME_ROWS_STORAGE_KEY, 'd');
    const { result } = renderHook(() => useHomeRowsVariant(null));
    expect(result.current).toBe('d');
  });

  it('the param wins over the saved pick, and today clears a pick', () => {
    window.localStorage.setItem(HOME_ROWS_STORAGE_KEY, 'd');
    const { result, rerender } = renderHook(({ p }) => useHomeRowsVariant(p), { initialProps: { p: 'a' as string | null } });
    expect(result.current).toBe('a');
    rerender({ p: 'today' });
    expect(result.current).toBe('today');
    expect(window.localStorage.getItem(HOME_ROWS_STORAGE_KEY)).toBe('today');
  });

  it('ignores a param it does not know and falls back to the saved pick', () => {
    window.localStorage.setItem(HOME_ROWS_STORAGE_KEY, 'c');
    const { result } = renderHook(() => useHomeRowsVariant('zzz'));
    expect(result.current).toBe('c');
  });
});
