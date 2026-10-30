// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'member' | 'anon' }));

vi.mock('@/lib/auth', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthorizedError,
    ForbiddenError,
    requireAdmin: async () => {
      if (state.role === 'anon') throw new UnauthorizedError();
      if (state.role === 'member') throw new ForbiddenError();
      return { user: { id: 'admin1', email: 'admin@ember.test' } };
    },
    unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
    forbiddenResponse: () => Response.json({ error: 'Forbidden' }, { status: 403 }),
  };
});

const getFullList = vi.fn();
const getDevices = vi.hoisted(() => vi.fn(async (): Promise<unknown[]> => []));

// The server PocketBase client's own `files.getURL()` is bound to the
// internal POCKETBASE_URL (e.g. http://127.0.0.1:8090), which is exactly
// the broken-image bug: a browser on another machine can't reach it. The
// route must not call it, it should call the shared `fileUrl()` helper
// instead, which always returns a same-origin `/pb/...` path. Wiring this
// mock to return the internal URL means the assertions below fail loudly
// if the route regresses to calling it directly.
vi.mock('@/lib/pocketbase/server', () => ({
  createAdminClient: async () => ({
    collection: (name: string) =>
      name === 'user_devices'
        ? { getFullList: () => getDevices() }
        : { getFullList: (opts: unknown) => getFullList(opts) },
    files: { getURL: () => 'http://127.0.0.1:8090/api/files/users/u1/avatar.png' },
  }),
}));

vi.mock('@/lib/upsertTrack', () => ({
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const update = vi.hoisted(() => ({ releases: {} as Record<string, string> }));
vi.mock('@/lib/desktopUpdate', () => ({
  isUpdateConfigured: () => Object.keys(update.releases).length > 0,
  latestReleaseWithin: async (_ms: number, platform: string) =>
    update.releases[platform] ? { tag_name: `${platform}-v${update.releases[platform]}` } : null,
  releaseVersion: (r: { tag_name: string }) => r.tag_name.replace(/^.*-v/, ''),
}));

const { GET } = await import('./route');

const request = () => ({}) as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  state.role = 'admin';
  update.releases = {};
  getDevices.mockReset();
  getDevices.mockResolvedValue([]);
  vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '0.7.34 (a1b2c3d 2026-10-22)');
});

describe('GET /api/admin/users', () => {
  it('returns a same-origin /pb avatar URL, not the internal server URL', async () => {
    getFullList.mockResolvedValue([
      { id: 'u1', collectionId: 'col_users', collectionName: 'users', email: 'a@b.c', name: 'Robin', avatar: 'avatar.png', is_admin: false, created: '2024-01-01' },
    ]);

    const res = await GET(request(), undefined as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.users[0].avatarUrl).toBe('/pb/api/files/col_users/u1/avatar.png');
  });

  it('returns null avatarUrl for a user with no avatar', async () => {
    getFullList.mockResolvedValue([
      { id: 'u2', collectionId: 'col_users', collectionName: 'users', email: 'nobody@b.c', name: '', avatar: '', is_admin: false, created: '2024-01-01' },
    ]);

    const body = await (await GET(request(), undefined as never)).json();

    expect(body.users[0].avatarUrl).toBeNull();
  });

  describe('devices', () => {
    const member = { id: 'u1', collectionId: 'c', collectionName: 'users', email: 'a@b.c', name: '', avatar: '', is_admin: false, created: '' };
    const quiet = { ...member, id: 'u2', email: 'q@b.c' };
    const row = (over: Record<string, unknown> = {}) => ({
      id: 'r1',
      user: 'u1',
      device_key: 'secret-device-key',
      platform: 'android',
      shell_version: '0.4.27',
      web_version: '0.7.34',
      last_seen: '2026-10-30 10:00:00.000Z',
      ...over,
    });

    it('lists each member with their own devices, marked against the newest release', async () => {
      update.releases = { android: '0.4.28' };
      getFullList.mockResolvedValue([member, quiet]);
      getDevices.mockResolvedValue([row(), row({ id: 'r2', platform: 'browser', shell_version: '', web_version: '0.7.33' })]);
      const body = await (await GET(request(), undefined as never)).json();
      expect(body.users[1].devices).toEqual([]);
      expect(body.users[0].devices).toEqual([
        {
          id: 'r1',
          platform: 'android',
          shellVersion: '0.4.27',
          webVersion: '0.7.34',
          lastSeen: '2026-10-30 10:00:00.000Z',
          newestShell: '0.4.28',
          newestWeb: '0.7.34',
          shellBehind: true,
          webBehind: false,
        },
        {
          id: 'r2',
          platform: 'browser',
          shellVersion: null,
          webVersion: '0.7.33',
          lastSeen: '2026-10-30 10:00:00.000Z',
          newestShell: null,
          newestWeb: '0.7.34',
          shellBehind: false,
          webBehind: true,
        },
      ]);
    });

    it('never hands out the device key', async () => {
      getFullList.mockResolvedValue([member]);
      getDevices.mockResolvedValue([row()]);
      const text = await (await GET(request(), undefined as never)).text();
      expect(text).not.toContain('secret-device-key');
    });

    it('the Users page still works before PocketBase has the collection', async () => {
      getFullList.mockResolvedValue([member]);
      getDevices.mockRejectedValue(new Error('missing collection'));
      const res = await GET(request(), undefined as never);
      expect(res.status).toBe(200);
      expect((await res.json()).users[0].devices).toEqual([]);
    });
  });

  it('refuses a normal member', async () => {
    state.role = 'member';
    const res = await GET(request(), undefined as never);
    expect(res.status).toBe(403);
    expect(getFullList).not.toHaveBeenCalled();
    expect(getDevices).not.toHaveBeenCalled();
  });

  it('refuses a signed-out caller', async () => {
    state.role = 'anon';
    const res = await GET(request(), undefined as never);
    expect(res.status).toBe(401);
  });
});
