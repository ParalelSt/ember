import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

/** The theme wiring in AuthProvider: load per user, reset on sign-out, and
 *  the cookie writer that puts a changed theme into the auth record. */

const authStore = {
  token: 'tok',
  isValid: true,
  record: { id: 'u1', email: 'a@b.c', created: '2026-01-01', theme: null } as Record<string, unknown> | null,
  save: vi.fn((token: string, record: Record<string, unknown>) => {
    authStore.token = token;
    authStore.record = record;
  }),
  onChange: () => () => {},
  clear: vi.fn(),
};
vi.mock('@/lib/pocketbase/client', () => ({
  createClient: () => ({ authStore, collection: () => ({ authRefresh: vi.fn(async () => ({})) }), files: { getURL: () => '' } }),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('@/stores/usePrivacyStore', () => ({ usePrivacyStore: { getState: () => ({ load: vi.fn() }) } }));
vi.mock('@/stores/useChangelogStore', () => ({ useChangelogStore: { getState: () => ({ load: vi.fn() }), setState: vi.fn() } }));
vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ loadPlugins: vi.fn(), resetPluginSync: vi.fn() }) },
}));
const loadTheme = vi.fn(async () => {});
const resetThemeSync = vi.fn();
let writer: ((doc: unknown) => void) | null = null;
vi.mock('@/stores/useThemeStore', () => ({
  useThemeStore: { getState: () => ({ loadTheme, resetThemeSync }) },
  registerThemeCookieWriter: (w: typeof writer) => {
    writer = w;
  },
}));
vi.mock('@/lib/logger/client', () => ({ logger: { error: vi.fn(), breadcrumb: vi.fn(), warn: vi.fn() } }));

const { AuthProvider } = await import('./AuthProvider');

const user = { id: 'u1', email: 'a@b.c', name: 'A', avatarUrl: null, isAdmin: false };

beforeEach(() => {
  loadTheme.mockClear();
  resetThemeSync.mockClear();
  authStore.save.mockClear();
  authStore.isValid = true;
  authStore.record = { id: 'u1', email: 'a@b.c', created: '2026-01-01', theme: null };
  writer = null;
});

describe('AuthProvider theme wiring', () => {
  it('loads the theme for the signed-in user', () => {
    render(<AuthProvider initialUser={user}><div /></AuthProvider>);
    expect(loadTheme).toHaveBeenCalledWith('u1');
    expect(resetThemeSync).not.toHaveBeenCalled();
  });

  it('stops syncing when signed out', () => {
    authStore.isValid = false;
    render(<AuthProvider initialUser={null}><div /></AuthProvider>);
    expect(resetThemeSync).toHaveBeenCalled();
    expect(loadTheme).not.toHaveBeenCalled();
  });

  it('writes a changed theme into the auth record once, keeping the rest of it', () => {
    const { unmount } = render(<AuthProvider initialUser={user}><div /></AuthProvider>);
    expect(writer).not.toBeNull();
    writer!({ v: 1, preset: 'midnight' });
    expect(authStore.save).toHaveBeenCalledWith('tok', {
      id: 'u1',
      email: 'a@b.c',
      created: '2026-01-01',
      theme: { v: 1, preset: 'midnight' },
    });
    writer!({ v: 1, preset: 'midnight' });
    expect(authStore.save).toHaveBeenCalledTimes(1);
    // The default on a record that never had a theme is not a change.
    authStore.record = { id: 'u1', created: '2026-01-01', theme: null };
    writer!({ v: 1, preset: 'ember' });
    expect(authStore.save).toHaveBeenCalledTimes(1);
    unmount();
    expect(writer).toBeNull();
  });

  it('writes nothing without a valid session', () => {
    render(<AuthProvider initialUser={user}><div /></AuthProvider>);
    authStore.isValid = false;
    writer!({ v: 1, preset: 'mono' });
    expect(authStore.save).not.toHaveBeenCalled();
  });
});
