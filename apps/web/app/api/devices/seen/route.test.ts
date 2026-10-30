// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const requireUser = vi.hoisted(() => vi.fn());
const rateLimit = vi.hoisted(() => vi.fn((): Response | null => null));
const save = vi.hoisted(() => vi.fn(async () => true));
const adminClient = vi.hoisted(() => vi.fn(async () => ({})));
const warn = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth', () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    requireUser,
    unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  };
});
vi.mock('@/lib/rateLimit', () => ({ rateLimitResponse: rateLimit }));
vi.mock('@/lib/pocketbase/server', () => ({ createAdminClient: adminClient }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { warn, error: vi.fn() } }));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));
vi.mock('@/lib/versions/store', async (original) => ({
  ...(await original<typeof import('@/lib/versions/store')>()),
  saveDeviceSeen: save,
}));

const { POST } = await import('./route');
const { UnauthorizedError } = await import('@/lib/auth');

const good = { deviceId: 'device-aaaa', platform: 'android', shellVersion: '0.4.28', webVersion: '0.7.34 (a 2026-10-22)' };
const request = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const post = (body: unknown) => POST(request(body), undefined as never);

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ user: { id: 'u1', email: 'a@ember.test' } });
  rateLimit.mockReturnValue(null);
  save.mockResolvedValue(true);
  adminClient.mockResolvedValue({});
});

describe('POST /api/devices/seen', () => {
  it('saves under the member of the session, cleaned', async () => {
    const res = await post({ ...good, user: 'someone-else', userId: 'someone-else' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, saved: true });
    expect(save).toHaveBeenCalledWith({}, 'u1', {
      deviceId: 'device-aaaa',
      platform: 'android',
      shellVersion: '0.4.28',
      webVersion: '0.7.34',
    });
  });

  it('refuses someone signed out, without touching storage', async () => {
    requireUser.mockRejectedValue(new UnauthorizedError());
    const res = await post(good);
    expect(res.status).toBe(401);
    expect(adminClient).not.toHaveBeenCalled();
  });

  it('refuses a body that is not a note', async () => {
    for (const bad of [null, {}, { ...good, platform: 'toaster' }, { ...good, deviceId: '"; drop' }]) {
      expect((await post(bad)).status).toBe(400);
    }
    expect(save).not.toHaveBeenCalled();
  });

  it('holds to the rate limit', async () => {
    rateLimit.mockReturnValue(Response.json({ error: 'slow down' }, { status: 429 }));
    expect((await post(good)).status).toBe(429);
    expect(save).not.toHaveBeenCalled();
  });

  it('storage trouble is a quiet ok: false, not a 500 for the digest', async () => {
    save.mockRejectedValue(new Error('no such collection'));
    const res = await post(good);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false });
    expect(warn).toHaveBeenCalledWith('api', expect.any(String), { digest: false }, expect.any(Error));
  });
});
