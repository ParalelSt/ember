// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { beatBody, remoteLight } from '@/test-utils/remoteFixtures';

// The player's heartbeat route: a session is needed, the limiter holds, and
// the store is keyed by the session's user, never by anything in the body.

const who = vi.hoisted(() => ({ id: 'u1' as string | null }));
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return {
    ...actual,
    requireUser: async () => {
      if (!who.id) throw new actual.UnauthorizedError();
      return { pb: {}, user: { id: who.id, email: `${who.id}@x`, isAdmin: false } };
    },
  };
});
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_n: string, h: unknown) => h }));

const { POST } = await import('./route');
const { remoteStore } = await import('@/lib/remote/store');
const { _resetBuckets } = await import('@/lib/rateLimitCore');

const post = (body: unknown) =>
  POST(new NextRequest('http://t/api/remote/beat', { method: 'POST', body: JSON.stringify(body) }), undefined as never);

beforeEach(() => {
  who.id = 'u1';
  remoteStore().clear();
  _resetBuckets();
});

describe('POST /api/remote/beat', () => {
  it('needs a session', async () => {
    who.id = null;
    expect((await post(beatBody('win-device-1'))).status).toBe(401);
  });

  it('refuses a body that is not a beat', async () => {
    expect((await post({ deviceId: 'x' })).status).toBe(400);
    expect((await post(beatBody('win-device-1', { light: remoteLight() }))).status).toBe(400);
  });

  it('answers the commands waiting, the watchers and the active device', async () => {
    const res = await post(beatBody('win-device-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ commands: [], watchers: 0, active: 'win-device-1' });
    expect(typeof body.now).toBe('number');
  });

  it('keys the store by the session user, never by the body', async () => {
    await post({ ...beatBody('win-device-1'), userId: 'u2', user: 'u2' });
    expect(remoteStore().state('u2', 'phone-device-1', null, Date.now()).devices).toEqual([]);
    expect(remoteStore().state('u1', 'phone-device-1', null, Date.now()).devices).toHaveLength(1);
  });

  it('answers 429 over 90 beats a minute', async () => {
    for (let i = 0; i < 90; i++) expect((await post(beatBody('win-device-1', { full: undefined, light: remoteLight() }))).status).toBe(200);
    expect((await post(beatBody('win-device-1'))).status).toBe(429);
  });

  it('holds a beat with nothing to say until a command comes in', async () => {
    await post(beatBody('win-device-1'));
    let answered: { commands: { type: string }[] } | null = null;
    const pending = Promise.resolve(post(beatBody('win-device-1', { full: undefined, light: remoteLight(), hold: true })))
      .then(async (r: Response) => { answered = await r.json(); });
    await new Promise((r) => setTimeout(r, 30));
    expect(answered).toBeNull();
    remoteStore().command('u1', 'win-device-1', 'phone-device-1', { type: 'pause' }, Date.now());
    await pending;
    expect(answered!.commands.map((c) => c.type)).toEqual(['pause']);
  });

  it('answers a held beat at once when a command already waits', async () => {
    await post(beatBody('win-device-1'));
    remoteStore().command('u1', 'win-device-1', 'phone-device-1', { type: 'next' }, Date.now());
    const res = await post(beatBody('win-device-1', { full: undefined, light: remoteLight(), hold: true }));
    expect((await res.json()).commands.map((c: { type: string }) => c.type)).toEqual(['next']);
  });
});

