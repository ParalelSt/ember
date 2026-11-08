// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { beatBody, remoteLight } from '@/test-utils/remoteFixtures';
import type { BeatBody } from '@/lib/remote/types';

// The controller's poll: only the account's own devices, a light answer
// when nothing but the playhead moved.

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

const { GET } = await import('./route');
const { remoteStore } = await import('@/lib/remote/store');
const { _resetBuckets } = await import('@/lib/rateLimitCore');
const { parseBeat } = await import('@/lib/remote/parse');

const get = (query: string) => GET(new NextRequest(`http://t/api/remote/state?${query}`), undefined as never);
const seed = (user: string, body: Record<string, unknown>, now = Date.now()) =>
  remoteStore().beat(user, parseBeat(body) as BeatBody, now);

beforeEach(() => {
  who.id = 'u1';
  remoteStore().clear();
  _resetBuckets();
});

describe('GET /api/remote/state', () => {
  it('needs a session and a device id', async () => {
    who.id = null;
    expect((await get('device=phone-device-1')).status).toBe(401);
    who.id = 'u1';
    expect((await get('device=no')).status).toBe(400);
  });

  it('lists the account own devices only: a second user never sees them', async () => {
    seed('u1', beatBody('win-device-1'));
    const mine = await (await get('device=phone-device-1')).json();
    expect(mine.devices.map((d: { deviceId: string }) => d.deviceId)).toEqual(['win-device-1']);
    expect(mine.active).toBe('win-device-1');
    who.id = 'u2';
    const theirs = await (await get('device=phone-device-1')).json();
    expect(theirs.devices).toEqual([]);
    expect(theirs.active).toBeNull();
  });

  it('answers light when the rev is the same', async () => {
    const t0 = Date.now();
    seed('u1', beatBody('win-device-1'), t0);
    const first = await (await get('device=phone-device-1')).json();
    seed('u1', beatBody('win-device-1', { full: undefined, light: remoteLight({ position: 44 }) }), t0 + 1);
    const second = await (await get(`device=phone-device-1&rev=${first.rev}`)).json();
    expect(second.light).toBe(true);
    expect(second.devices).toEqual([{ deviceId: 'win-device-1', position: 44, isPlaying: true, at: t0 + 1 }]);
  });

  it('answers 429 over 90 polls a minute', async () => {
    for (let i = 0; i < 90; i++) expect((await get('device=phone-device-1')).status).toBe(200);
    expect((await get('device=phone-device-1')).status).toBe(429);
  });
});
