import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from './api';
import { logger } from '@/lib/logger/client';
import { onSessionExpired } from './sessionExpired';

// req() is the shared fetch wrapper every api.* call goes through; exercise
// it via api.getPlaylists (a plain GET with no body) rather than reaching
// into the unexported req().

vi.mock('@/lib/logger/client', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const originalLocation = window.location;

function setLocation(pathname: string, search = '') {
  // happy-dom's window.location is writable via delete/reassign in tests.
  // @ts-expect-error -- test-only stand-in
  delete window.location;
  // @ts-expect-error -- test-only stand-in
  window.location = { pathname, search, href: `${pathname}${search}` } as Location;
}

beforeEach(() => {
  setLocation('/library');
});

afterEach(() => {
  // @ts-expect-error -- restore the real location
  window.location = originalLocation;
});

describe('req() [bughunt W05]: 401 sends the browser to sign in', () => {
  it('redirects to /auth?next=<current page> on a 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      json: async () => ({ error: 'Unauthorized' }),
    }));
    setLocation('/library/liked', '?tab=all');

    await expect(api.listPlaylists()).rejects.toMatchObject({ status: 401 });
    expect(window.location.href).toBe('/auth?next=%2Flibrary%2Fliked%3Ftab%3Dall');
  });

  it('does not redirect on other error statuses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers(),
      json: async () => ({ error: 'boom' }),
    }));
    const before = window.location.href;

    await expect(api.listPlaylists()).rejects.toMatchObject({ status: 500 });
    expect(window.location.href).toBe(before);
  });

  it('does not redirect a 401 that happens while already on /auth', async () => {
    setLocation('/auth', '?next=%2Flibrary');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      json: async () => ({ error: 'Unauthorized' }),
    }));
    const before = window.location.href;

    await expect(api.listPlaylists()).rejects.toMatchObject({ status: 401 });
    expect(window.location.href).toBe(before);
  });
});

const unauthorized = () => vi.fn().mockResolvedValue({
  ok: false,
  status: 401,
  headers: new Headers(),
  json: async () => ({ error: 'Unauthorized' }),
});

describe('req() [bughunt V5]: a 401 drops the dead session', () => {
  afterEach(() => {
    document.cookie = 'pb_auth=; Path=/; Max-Age=0';
    vi.mocked(logger.error).mockClear();
    vi.mocked(logger.warn).mockClear();
  });

  it('tells the app the session is gone and clears the cookie, even on /auth', async () => {
    for (const where of ['/library', '/auth']) {
      setLocation(where);
      document.cookie = 'pb_auth=stale; Path=/';
      const expired = vi.fn();
      const off = onSessionExpired(expired);
      vi.stubGlobal('fetch', unauthorized());
      await expect(api.listLikes()).rejects.toMatchObject({ status: 401 });
      off();
      expect(expired, where).toHaveBeenCalledTimes(1);
      expect(document.cookie, where).not.toContain('pb_auth=stale');
    }
  });

  it('logs a 401 as a warning, never an error (errors send automatic bug reports)', async () => {
    vi.stubGlobal('fetch', unauthorized());
    await expect(api.getPrivacy()).rejects.toMatchObject({ status: 401 });
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('does not bounce a public page to sign in', async () => {
    for (const where of ['/track/abc123', '/privacy', '/terms']) {
      setLocation(where);
      vi.stubGlobal('fetch', unauthorized());
      await expect(api.listLikes()).rejects.toMatchObject({ status: 401 });
      expect(window.location.href, where).toBe(where);
    }
  });

  it('the silent prank calls drop the session on a 401 too', async () => {
    const expired = vi.fn();
    const off = onSessionExpired(expired);
    vi.stubGlobal('fetch', unauthorized());
    await expect(api.pranks.inbox()).rejects.toMatchObject({ status: 401 });
    off();
    expect(expired).toHaveBeenCalledTimes(1);
  });
});
