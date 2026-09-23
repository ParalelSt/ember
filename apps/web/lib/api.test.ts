import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from './api';

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
