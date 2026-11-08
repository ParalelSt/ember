// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { beatBody, queueOf, remoteLight } from '@/test-utils/remoteFixtures';
import { STALE_MS, type BeatBody } from '@/lib/remote/types';

// A button pressed on one device for another: 202 and the command in the
// target's next beat; 409 for a target that is not reachable; 413 for a
// queue that is too long; the tighter setQueue limit.

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
const { parseBeat } = await import('@/lib/remote/parse');

const WIN = 'win-device-1';
const PHONE = 'phone-device-1';
const post = (body: unknown) =>
  POST(new NextRequest('http://t/api/remote/command', { method: 'POST', body: JSON.stringify(body) }), undefined as never);
const seed = (user: string, now = Date.now()) => remoteStore().beat(user, parseBeat(beatBody(WIN)) as BeatBody, now);
const lightBeat = (user: string, now = Date.now()) =>
  remoteStore().beat(user, parseBeat(beatBody(WIN, { full: undefined, light: remoteLight() })) as BeatBody, now);
const setQueue = (n: number) => ({ target: WIN, from: PHONE, type: 'setQueue', args: { tracks: queueOf(n), index: 0, play: true, startSec: 0, context: null } });

beforeEach(() => {
  who.id = 'u1';
  remoteStore().clear();
  _resetBuckets();
});

describe('POST /api/remote/command', () => {
  it('needs a session', async () => {
    who.id = null;
    expect((await post({ target: WIN, type: 'pause' })).status).toBe(401);
  });

  it('answers 202 and the command is in the target next beat', async () => {
    seed('u1');
    const res = await post({ target: WIN, from: PHONE, type: 'pause' });
    expect(res.status).toBe(202);
    const { id } = await res.json();
    const next = lightBeat('u1');
    expect(next.commands).toEqual([expect.objectContaining({ id, type: 'pause', issuedBy: PHONE })]);
  });

  it('answers 409 for a stale target, and for another user device', async () => {
    seed('u1', Date.now() - STALE_MS - 1000);
    const stale = await post({ target: WIN, type: 'pause' });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toBe('Windows is not reachable');
    seed('u2');
    expect((await post({ target: WIN, type: 'pause' })).status).toBe(409);
    expect(lightBeat('u2').commands).toEqual([]);
  });

  it('answers 400 on a bad body and 413 for an oversized queue', async () => {
    seed('u1');
    expect((await post({ target: WIN, type: 'seek', args: { sec: -5 } })).status).toBe(400);
    expect((await post({ target: WIN, type: 'reboot' })).status).toBe(400);
    expect((await post(setQueue(301))).status).toBe(413);
    expect((await post(setQueue(300))).status).toBe(202);
  });

  it('answers 429 over 60 commands a minute', async () => {
    seed('u1');
    for (let i = 0; i < 60; i++) expect((await post({ target: WIN, type: 'next' })).status).toBe(202);
    expect((await post({ target: WIN, type: 'next' })).status).toBe(429);
  });

  it('holds setQueue to 20 a minute', async () => {
    seed('u1');
    for (let i = 0; i < 20; i++) expect((await post(setQueue(1))).status).toBe(202);
    expect((await post(setQueue(1))).status).toBe(429);
    expect((await post({ target: WIN, type: 'play' })).status).toBe(202);
  });
});
