import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { makeTrack } from '@/test-utils/fakeBackend';

/** Signing out drops the saved queue and what was playing (ember.player.v1
 *  in localStorage). It used to survive the hard navigation, so the next
 *  account on the same device opened onto the last person's queue, playlist
 *  context and place in the song. Device preferences (volume, loop, mute)
 *  stay. */

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
vi.mock('next/navigation', () => ({ usePathname: () => '/library' }));

const { AuthProvider, useAuth } = await import('./AuthProvider');

const user = { id: 'u1', email: 'a@b.c', name: 'A', avatarUrl: null, isAdmin: false };

beforeEach(() => {
  const t = makeTrack({ id: 'youtube:a1' });
  usePlayerStore.setState({
    queue: [t],
    index: 0,
    position: 42,
    context: { type: 'playlist', id: 'pl1', name: 'Diary' } as never,
    baseCount: 1,
    volume: 0.6,
    loopMode: 'all',
    muted: true,
  });
});

describe('AuthProvider sign-out', () => {
  it("clears the saved queue and now playing, keeping the device's volume, loop and mute", async () => {
    let signOut: (() => Promise<void>) | null = null;
    function Grab() {
      signOut = useAuth().signOut;
      return null;
    }
    render(<AuthProvider initialUser={user}><Grab /></AuthProvider>);
    await act(async () => {
      await signOut!();
    });

    const s = usePlayerStore.getState();
    expect(s).toMatchObject({ queue: [], index: -1, position: 0, context: null, baseCount: 0 });
    expect(s).toMatchObject({ volume: 0.6, loopMode: 'all', muted: true });
    const saved = JSON.parse(localStorage.getItem('ember.player.v1') ?? '{}') as { state?: { queue?: unknown[] } };
    expect(saved.state?.queue).toEqual([]);
  });

  it('tells the other open tabs, which drop the queue too instead of saving it back', async () => {
    let signOut: (() => Promise<void>) | null = null;
    function Grab() {
      signOut = useAuth().signOut;
      return null;
    }
    render(<AuthProvider initialUser={user}><Grab /></AuthProvider>);
    await act(async () => {
      await signOut!();
    });
    expect(localStorage.getItem('ember.signedOut')).toBeTruthy();
  });

  it('another tab signing out clears this tab\'s queue and session, so its next save is empty', async () => {
    authStore.clear.mockClear();
    render(<AuthProvider initialUser={user}><div /></AuthProvider>);
    // This tab still holds the queue in memory, as an open player would.
    expect(usePlayerStore.getState().queue).toHaveLength(1);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'ember.signedOut', newValue: String(Date.now()) }));
    });
    const s = usePlayerStore.getState();
    expect(s).toMatchObject({ queue: [], index: -1, position: 0, context: null, baseCount: 0 });
    expect(s).toMatchObject({ volume: 0.6, loopMode: 'all', muted: true });
    const saved = JSON.parse(localStorage.getItem('ember.player.v1') ?? '{}') as { state?: { queue?: unknown[] } };
    expect(saved.state?.queue).toEqual([]);
    expect(authStore.clear).toHaveBeenCalled();
    // Other keys are not a sign-out.
    usePlayerStore.setState({ queue: [makeTrack({ id: 'youtube:b2' })], index: 0 });
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'ember.player.v1', newValue: '{}' }));
    });
    expect(usePlayerStore.getState().queue).toHaveLength(1);
  });

  it('a sign-out heard late (a tab the browser had frozen), after someone signed in again, leaves the new session and its queue alone', () => {
    authStore.clear.mockClear();
    render(<AuthProvider initialUser={user}><div /></AuthProvider>);
    // Another tab signed out, then someone signed in there: the cookie is
    // theirs now, and so is the saved queue.
    const fresh = { token: 'tok-new', record: { id: 'u2' } };
    document.cookie = `pb_auth=${encodeURIComponent(JSON.stringify(fresh))}; path=/`;
    localStorage.setItem('ember.player.v1', JSON.stringify({ state: { queue: [{ id: 'youtube:new' }] }, version: 0 }));
    try {
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', { key: 'ember.signedOut', newValue: String(Date.now() - 60_000) }));
      });
      expect(authStore.clear).not.toHaveBeenCalled();
      const saved = JSON.parse(localStorage.getItem('ember.player.v1') ?? '{}') as { state?: { queue?: { id: string }[] } };
      expect(saved.state?.queue).toEqual([{ id: 'youtube:new' }]);
    } finally {
      document.cookie = 'pb_auth=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    }
  });
});
