import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useSessionStore } from '@/stores/useSessionStore';

/** Signing out drops the carlist hosting flag, so the next account on this
 *  device doesn't inherit "hosting" (and radio stays on). Bughunt X6. */

const authStore = {
  token: 'tok',
  isValid: true,
  record: { id: 'u1', email: 'a@b.c' } as Record<string, unknown> | null,
  save: vi.fn(),
  onChange: () => () => {},
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

const { AuthProvider, useAuth } = await import('./AuthProvider');

const user = { id: 'u1', email: 'a@b.c', name: 'A', avatarUrl: null, isAdmin: false };

beforeEach(() => {
  useSessionStore.setState({ hostingSessionId: 's1' });
});

describe('AuthProvider sign-out', () => {
  it('clears the carlist hosting flag', async () => {
    let signOut: (() => Promise<void>) | null = null;
    function Grab() {
      signOut = useAuth().signOut;
      return null;
    }
    render(<AuthProvider initialUser={user}><Grab /></AuthProvider>);
    await act(async () => {
      await signOut!();
    });
    expect(authStore.clear).toHaveBeenCalled();
    expect(useSessionStore.getState().hostingSessionId).toBeNull();
  });
});
