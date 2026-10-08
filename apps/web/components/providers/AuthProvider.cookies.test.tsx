import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

/** Every session change (sign-in, sign-out, a refreshed token) asks the
 *  phone app to write the cookie to disk at once (lib/nativeCookies). */

const listeners = vi.hoisted(() => [] as (() => void)[]);
const authStore = {
  token: 'tok',
  isValid: true,
  record: { id: 'u1', email: 'a@b.c' } as Record<string, unknown> | null,
  save: vi.fn(),
  onChange: (fn: () => void) => {
    listeners.push(fn);
    return () => {};
  },
  clear: vi.fn(),
};
vi.mock('@/lib/pocketbase/client', () => ({
  createClient: () => ({ authStore, collection: () => ({ authRefresh: vi.fn(async () => ({})) }), files: { getURL: () => '' } }),
}));
vi.mock('@/stores/usePrivacyStore', () => ({ usePrivacyStore: { getState: () => ({ load: vi.fn() }) } }));
vi.mock('@/stores/useChangelogStore', () => ({ useChangelogStore: { getState: () => ({ load: vi.fn() }), setState: vi.fn() } }));
vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ loadPlugins: vi.fn(), resetPluginSync: vi.fn() }) },
}));
vi.mock('@/stores/useThemeStore', () => ({
  useThemeStore: { getState: () => ({ loadTheme: vi.fn(async () => {}), resetThemeSync: vi.fn() }) },
  registerThemeCookieWriter: () => {},
}));
vi.mock('@/lib/logger/client', () => ({ logger: { error: vi.fn(), breadcrumb: vi.fn(), warn: vi.fn() } }));
vi.mock('next/navigation', () => ({ usePathname: () => '/library' }));
const flush = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/lib/nativeCookies', () => ({ flushNativeCookies: flush }));

const { AuthProvider } = await import('./AuthProvider');

const user = { id: 'u1', email: 'a@b.c', name: 'A', avatarUrl: null, isAdmin: false };

beforeEach(() => {
  listeners.length = 0;
  flush.mockClear();
});

describe('AuthProvider: the session cookie reaches disk on the phone', () => {
  it('flushes after every auth change', () => {
    render(<AuthProvider initialUser={user}><span /></AuthProvider>);
    expect(flush).not.toHaveBeenCalled();
    act(() => listeners.forEach((fn) => fn()));
    expect(flush).toHaveBeenCalledTimes(1);
    authStore.record = null;
    act(() => listeners.forEach((fn) => fn()));
    expect(flush).toHaveBeenCalledTimes(2);
  });
});
