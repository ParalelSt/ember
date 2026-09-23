import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import type { PresetId, ThemeDoc } from '@/lib/theme/model';
import { derive } from '@/lib/theme/derive';
import { PRESET_BY_ID } from '@/lib/theme/presets';

const auth = { user: null as { id: string } | null };
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => auth }));
const warn = vi.fn();
vi.mock('@/lib/logger/client', () => ({ logger: { warn: (...a: unknown[]) => warn(...a), error: vi.fn(), breadcrumb: vi.fn() } }));
vi.mock('@/lib/api', () => ({ api: {} }));

const { ThemeApplier } = await import('./ThemeApplier');
const { useThemeStore } = await import('@/stores/useThemeStore');

const initial = useThemeStore.getState();
const bg = () => document.documentElement.style.getPropertyValue('--background');
const MIDNIGHT: ThemeDoc = { v: 1, preset: 'midnight' };
/** A preset's --background, as the page should carry it. */
const bgOf = (id: PresetId) => derive(PRESET_BY_ID[id].inputs).vars['--background'];

beforeEach(() => {
  useThemeStore.setState(initial, true);
  auth.user = { id: 'u1' };
  warn.mockReset();
});
afterEach(() => {
  document.documentElement.removeAttribute('style');
});

describe('ThemeApplier', () => {
  it("applies the server's doc over this device's cache on mount", () => {
    useThemeStore.setState({ doc: { v: 1, preset: 'mono' } });
    const events = vi.fn();
    window.addEventListener('ember:theme', events);
    render(<ThemeApplier initial={MIDNIGHT} />);
    window.removeEventListener('ember:theme', events);
    expect(bg()).toBe(bgOf('midnight'));
    expect(useThemeStore.getState().doc).toEqual(MIDNIGHT);
    // Straight to Midnight: the cached Mono never reached the page.
    expect(events).toHaveBeenCalledTimes(1);
  });

  it('keeps the cache when the server painted nothing it knew, and warns when the record was stripped', () => {
    useThemeStore.setState({ doc: { v: 1, preset: 'mono' } });
    render(<ThemeApplier initial={null} stripped />);
    expect(bg()).toBe(bgOf('mono'));
    expect(warn).toHaveBeenCalledWith('theme', 'cookie record stripped');
  });

  it('follows store changes, a draft preview first, and clears everything for Ember', () => {
    render(<ThemeApplier initial={{ v: 1, preset: 'ember' }} />);
    expect(bg()).toBe('');
    act(() => useThemeStore.setState({ doc: MIDNIGHT }));
    expect(bg()).toBe(bgOf('midnight'));
    act(() => useThemeStore.getState().setPreview({ v: 1, preset: 'forest' }));
    expect(bg()).toBe(bgOf('forest'));
    act(() => useThemeStore.getState().setPreview(null));
    expect(bg()).toBe(bgOf('midnight'));
    act(() => useThemeStore.setState({ doc: { v: 1, preset: 'ember' } }));
    expect(document.documentElement.getAttribute('style') ?? '').toBe('');
  });

  it('shows Ember signed out, whatever is cached', () => {
    auth.user = null;
    useThemeStore.setState({ doc: MIDNIGHT });
    render(<ThemeApplier initial={null} />);
    expect(bg()).toBe('');
    expect(warn).not.toHaveBeenCalled();
    act(() => useThemeStore.setState({ doc: { v: 1, preset: 'forest' } }));
    expect(bg()).toBe('');
  });
});
