import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ClientResponseError } from 'pocketbase';

/** On mount without a server-known user (the cookie's record was stripped
 *  for size), a still-valid token is refreshed. Only the server refusing the
 *  session drops it: a dead connection or PocketBase answering 5xx (a
 *  restart) must keep the person signed in, as the comment there says. */

const authRefresh = vi.hoisted(() => vi.fn());
const authStore = {
  token: 'tok',
  isValid: true,
  record: null as Record<string, unknown> | null,
  save: vi.fn(),
  onChange: () => () => {},
  clear: vi.fn(),
};
vi.mock('@/lib/pocketbase/client', () => ({
  createClient: () => ({ authStore, collection: () => ({ authRefresh }), files: { getURL: () => '' } }),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
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

const { AuthProvider } = await import('./AuthProvider');

beforeEach(() => {
  authRefresh.mockReset();
  authStore.clear.mockClear();
});

async function mountWith(error: unknown) {
  authRefresh.mockRejectedValue(error);
  render(<AuthProvider initialUser={null}><span /></AuthProvider>);
  await waitFor(() => expect(authRefresh).toHaveBeenCalled());
  // Let the rejection's handlers run.
  await new Promise((r) => setTimeout(r, 0));
}

describe('AuthProvider start-up refresh', () => {
  it('keeps the session when the SDK reports no connection (status 0, "Something went wrong.")', async () => {
    await mountWith(new ClientResponseError({ status: 0, originalError: new TypeError('Failed to fetch') }));
    expect(authStore.clear).not.toHaveBeenCalled();
  });

  it('keeps the session when PocketBase answers 502 / 503 (restarting)', async () => {
    await mountWith(new ClientResponseError({ status: 502, response: {} }));
    await mountWith(new ClientResponseError({ status: 503, response: {} }));
    expect(authStore.clear).not.toHaveBeenCalled();
  });

  it('drops the session the server refuses (401, 403, 404 for a deleted account)', async () => {
    await mountWith(new ClientResponseError({ status: 401, response: { message: 'The request requires valid record authorization token.' } }));
    expect(authStore.clear).toHaveBeenCalledTimes(1);
    await mountWith(new ClientResponseError({ status: 403, response: {} }));
    expect(authStore.clear).toHaveBeenCalledTimes(2);
    await mountWith(new ClientResponseError({ status: 404, response: {} }));
    expect(authStore.clear).toHaveBeenCalledTimes(3);
  });
});
