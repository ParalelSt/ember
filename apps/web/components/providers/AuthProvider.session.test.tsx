import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useSessionStore } from '@/stores/useSessionStore';

/** A session the server refuses is dropped at once, and nobody counts as
 *  signed in on the sign-in page (bughunt V5). */

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

const pathname = vi.hoisted(() => ({ current: '/library' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

const { AuthProvider, useAuth } = await import('./AuthProvider');
const { sessionExpired } = await import('@/lib/sessionExpired');

const user = { id: 'u1', email: 'a@b.c', name: 'A', avatarUrl: null, isAdmin: false };

beforeEach(() => {
  pathname.current = '/library';
  authStore.clear.mockClear();
});

describe('AuthProvider [bughunt V5]: a dead session is dropped', () => {
  it('clears the auth store when an API call finds the session gone', () => {
    render(<AuthProvider initialUser={user}><span /></AuthProvider>);
    act(() => sessionExpired());
    expect(authStore.clear).toHaveBeenCalled();
  });

  it('has no signed-in user on the sign-in page, so nothing signed-in loads there', () => {
    pathname.current = '/auth';
    let seen: unknown = 'unset';
    function Grab() {
      seen = useAuth().user;
      return null;
    }
    render(<AuthProvider initialUser={user}><Grab /></AuthProvider>);
    expect(seen).toBeNull();
  });
});

describe('AuthProvider: QR sign-in', () => {
  it('adoptSession puts the approved session in the same store a password sign-in uses', () => {
    let adopt: ((t: string, r: { id: string } & Record<string, unknown>) => void) | null = null;
    function Grab() {
      adopt = useAuth().adoptSession;
      return null;
    }
    render(<AuthProvider initialUser={null}><Grab /></AuthProvider>);
    authStore.save.mockClear();
    act(() => adopt!('minted-token', { id: 'u9', email: 'n@b.c' }));
    expect(authStore.save).toHaveBeenCalledWith('minted-token', { id: 'u9', email: 'n@b.c' });
  });
});

describe('AuthProvider sign-out [bughunt X6]', () => {
  it('clears the carlist hosting flag, so the next account on this device does not inherit it', async () => {
    useSessionStore.setState({ hostingSessionId: 's1' });
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
