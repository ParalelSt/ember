import { describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

/** The privacy switches load once per account, not on every rewrite of the
 *  auth record (a theme change or a profile refresh saves the record again).
 *  A reload racing a switch the person just flipped could land after the
 *  save's answer and put the old value back (sharing again after "off"). */

let listener: (() => void) | null = null;
const authStore = {
  token: 'tok',
  isValid: true,
  record: { id: 'u1', email: 'a@b.c', theme: null } as Record<string, unknown> | null,
  save: vi.fn(),
  onChange: (fn: () => void) => {
    listener = fn;
    return () => {
      listener = null;
    };
  },
  clear: vi.fn(),
};
vi.mock('@/lib/pocketbase/client', () => ({
  createClient: () => ({ authStore, collection: () => ({ authRefresh: vi.fn(async () => ({})) }), files: { getURL: () => '' } }),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
const load = vi.fn(async () => {});
vi.mock('@/stores/usePrivacyStore', () => ({ usePrivacyStore: { getState: () => ({ load }) } }));
vi.mock('@/stores/useChangelogStore', () => ({ useChangelogStore: { getState: () => ({ load: vi.fn() }), setState: vi.fn() } }));
vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ loadPlugins: vi.fn(), resetPluginSync: vi.fn() }) },
}));
vi.mock('@/stores/useThemeStore', () => ({
  useThemeStore: { getState: () => ({ loadTheme: vi.fn(async () => {}), resetThemeSync: vi.fn() }) },
  registerThemeCookieWriter: () => {},
}));
vi.mock('@/lib/nativeCookies', () => ({ flushNativeCookies: vi.fn(async () => {}) }));
vi.mock('@/lib/logger/client', () => ({ logger: { error: vi.fn(), breadcrumb: vi.fn(), warn: vi.fn() } }));

const { AuthProvider } = await import('./AuthProvider');

describe('AuthProvider privacy load', () => {
  it('loads once per account, not again when the same account record is saved again', () => {
    const user = { id: 'u1', email: 'a@b.c', name: '', avatarUrl: null, isAdmin: false };
    render(<AuthProvider initialUser={user}><div /></AuthProvider>);
    expect(load).toHaveBeenCalledTimes(1);

    // A theme change writes the record back (same account, new object).
    authStore.record = { id: 'u1', email: 'a@b.c', theme: { v: 1, preset: 'midnight' } };
    act(() => listener?.());
    expect(load).toHaveBeenCalledTimes(1);

    // Another account: its own switches.
    authStore.record = { id: 'u2', email: 'c@d.e', theme: null };
    act(() => listener?.());
    expect(load).toHaveBeenCalledTimes(2);
  });
});
