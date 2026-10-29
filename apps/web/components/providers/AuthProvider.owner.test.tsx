import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { makeTrack } from '@/test-utils/fakeBackend';

/** Sign-out clears the saved queue (ember.player.v1), but a session can
 *  also end without one: it expired, or "Sign out everywhere" ran on
 *  another device, and this one just lands on /auth. The next account that
 *  signed in on it opened onto the last person's queue, playlist and place
 *  in the song. */

const authStore = {
  token: 'tok',
  isValid: true,
  record: null as Record<string, unknown> | null,
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
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

const { AuthProvider } = await import('./AuthProvider');

const member = (id: string) => ({ id, email: `${id}@b.c`, name: id, avatarUrl: null, isAdmin: false });

beforeEach(() => {
  localStorage.clear();
  usePlayerStore.setState({
    queue: [makeTrack({ id: 'youtube:a1' })],
    index: 0,
    position: 42,
    context: { type: 'playlist', id: 'pl1', name: 'Diary' } as never,
    baseCount: 1,
    volume: 0.6,
  });
});

describe('AuthProvider: the saved queue belongs to one account', () => {
  it('another account signing in on this device does not get the last one\'s queue', () => {
    const first = render(<AuthProvider initialUser={member('u1')}><div /></AuthProvider>);
    first.unmount();
    // u1's session ended without a sign-out (expired, or signed out
    // everywhere from a phone); u2 signs in on this browser.
    render(<AuthProvider initialUser={member('u2')}><div /></AuthProvider>);
    const s = usePlayerStore.getState();
    expect(s).toMatchObject({ queue: [], index: -1, position: 0, context: null, baseCount: 0 });
    expect(s.volume).toBe(0.6);
  });

  it('tells the player, so the Android app\'s native queue is dropped too', async () => {
    const { onAccountPlaybackCleared } = await import('@/lib/playback/accountPlayback');
    const heard = vi.fn();
    const off = onAccountPlaybackCleared(heard);
    try {
      render(<AuthProvider initialUser={member('u1')}><div /></AuthProvider>).unmount();
      expect(heard).not.toHaveBeenCalled();
      render(<AuthProvider initialUser={member('u2')}><div /></AuthProvider>);
      expect(heard).toHaveBeenCalledTimes(1);
    } finally {
      off();
    }
  });

  it('the same account coming back keeps its queue', () => {
    const first = render(<AuthProvider initialUser={member('u1')}><div /></AuthProvider>);
    first.unmount();
    render(<AuthProvider initialUser={member('u1')}><div /></AuthProvider>);
    expect(usePlayerStore.getState().queue).toHaveLength(1);
    expect(usePlayerStore.getState().position).toBe(42);
  });

  it('a queue saved before this was tracked is kept for whoever signs in first', () => {
    render(<AuthProvider initialUser={member('u1')}><div /></AuthProvider>);
    expect(usePlayerStore.getState().queue).toHaveLength(1);
  });
});
