// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { ServerLogEntry } from '@/lib/logger/types';

/** POST /api/native-log: the phone app's player log from the car. Members
 *  only, rate limited, size limited, schema checked, scrubbed, and stored as
 *  category 'native' with its surface. The real rate limiter runs. */

const state = vi.hoisted(() => ({ signedIn: true, stored: [] as ServerLogEntry[] }));

vi.mock('@/lib/auth', () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    requireUser: async () => {
      if (!state.signedIn) throw new UnauthorizedError();
      return { user: { id: 'u1', email: 'dev@ember.test' } };
    },
    verifiedUserId: async () => (state.signedIn ? 'u1' : null),
    unauthorizedResponse: () => Response.json({ error: 'Sign in.' }, { status: 401 }),
  };
});
vi.mock('@/lib/logger/server', () => ({
  serverLogger: { append: (e: ServerLogEntry) => state.stored.push(e), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('@/lib/upsertTrack', () => ({
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { POST } = await import('./route');
const { _resetBuckets } = await import('@/lib/rateLimit');

function request(body: unknown, headers: Record<string, string> = {}): NextRequest {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request('http://localhost/api/native-log', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: text,
  }) as unknown as NextRequest;
}

const now = Date.now();
const event = (over: Record<string, unknown> = {}) => ({
  ts: now - 1000,
  level: 'warn',
  event: 'play.stalled',
  message: 'play did not start within 8 s',
  surface: 'aaos',
  data: { state: 'buffering', blockedMs: 8000 },
  ...over,
});
const batch = (over: Record<string, unknown> = {}) => ({
  session: 'b1c2d3e4-0000-4000-8000-000000000000',
  device: { model: 'Google sdk_gcar_arm64', sdk: 34, app: '0.4.17' },
  events: [event()],
  ...over,
});

const post = (body: unknown, headers?: Record<string, string>) => POST(request(body, headers), undefined as never);

beforeEach(() => {
  state.signedIn = true;
  state.stored = [];
  _resetBuckets();
});

describe('POST /api/native-log', () => {
  it('needs a signed-in member', async () => {
    state.signedIn = false;
    const res = await post(batch());
    expect(res.status).toBe(401);
    expect(state.stored).toHaveLength(0);
  });

  it('takes the desktop app\'s launch gate events under surface desktop', async () => {
    const res = await post(batch({
      device: { model: 'Ember desktop', app: '0.4.23' },
      events: [event({ level: 'info', event: 'update.gate.check', message: 'update.gate.check', surface: 'desktop', data: { ms: 140, result: 'none', install: 'nsis' } })],
    }));
    expect(res.status).toBe(200);
    expect(state.stored[0]).toMatchObject({ surface: 'desktop', category: 'native', data: { event: 'update.gate.check', result: 'none' } });
  });

  it('stores each event as a native entry with its surface, user and device', async () => {
    const res = await post(batch({ events: [event(), event({ level: 'info', event: 'state', message: 'ready', surface: 'android-auto', data: undefined })] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, stored: 2 });
    const [a, b] = state.stored;
    expect(a).toMatchObject({
      category: 'native',
      level: 'warn',
      kind: 'error',
      surface: 'aaos',
      userId: 'u1',
      route: 'native-log',
      side: 'server',
      sessionId: 'native:b1c2d3e4-0000-4000-8000-000000000000',
      message: 'play did not start within 8 s',
      ts: now - 1000,
    });
    expect(a.data).toMatchObject({ event: 'play.stalled', state: 'buffering', device: { model: 'Google sdk_gcar_arm64', sdk: 34, app: '0.4.17' } });
    expect(b).toMatchObject({ level: 'info', kind: 'breadcrumb', surface: 'android-auto' });
  });

  it('notes events the device dropped', async () => {
    await post(batch({ dropped: 30 }));
    expect(state.stored).toHaveLength(2);
    expect(state.stored[1].message).toMatch(/30 event\(s\) dropped/);
  });

  it('uses the server time when the device clock is far off, keeping the device time', async () => {
    const skewed = now - 30 * 24 * 60 * 60 * 1000;
    await post(batch({ events: [event({ ts: skewed })] }));
    expect(Math.abs(state.stored[0].ts - Date.now())).toBeLessThan(5000);
    expect((state.stored[0].data as { deviceTs: number }).deviceTs).toBe(skewed);
  });

  it.each([
    ['not JSON', '{nope'],
    ['no events', batch({ events: [] })],
    ['too many events', batch({ events: Array.from({ length: 51 }, () => event()) })],
    ['an unknown surface', batch({ events: [event({ surface: 'tv' })] })],
    ['a bad level', batch({ events: [event({ level: 'fatal' })] })],
    ['a bad event name', batch({ events: [event({ event: 'Play Stalled' })] })],
    ['a huge message', batch({ events: [event({ message: 'x'.repeat(501) })] })],
    ['huge data', batch({ events: [event({ data: { blob: 'x'.repeat(3000) } })] })],
    ['extra device fields', batch({ device: { model: 'P', serial: 'ABC123' } })],
    ['a bad session id', batch({ session: '../../etc' })],
  ])('refuses %s with 400', async (_name, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(state.stored).toHaveLength(0);
  });

  it('refuses an oversized body with 413, by header or by content', async () => {
    expect((await post(batch(), { 'content-length': String(200 * 1024) })).status).toBe(413);
    const big = JSON.stringify({ ...batch(), pad: 'x'.repeat(70 * 1024) });
    expect((await post(big)).status).toBe(413);
    expect(state.stored).toHaveLength(0);
  });

  it('rate limits each member', async () => {
    for (let i = 0; i < 12; i++) expect((await post(batch())).status).toBe(200);
    const res = await post(batch());
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(state.stored).toHaveLength(12);
  });

  it('keeps stream URLs, cookies and tokens out of the log', async () => {
    await post(
      batch({
        events: [
          event({
            level: 'error',
            event: 'player.error',
            message: 'GET http://10.0.2.2:3069/api/youtube/stream/abc?sig=SECRETSIG failed, pb_auth=eyJhbGciOiJIUzI1NiJ9.x.y',
            data: {
              url: 'https://ember.example.com/api/youtube/stream/x?token=T0PSECRET',
              cookie: 'pb_auth=eyJ',
              accessToken: 'AT',
              email: 'owner@example.com',
              nested: { password: 'p', host: '10.0.2.2' },
            },
          }),
        ],
      }),
    );
    const stored = JSON.stringify(state.stored);
    for (const secret of ['SECRETSIG', 'eyJ', 'T0PSECRET', 'owner@example.com', '"AT"', '/api/youtube/stream', '"p"']) {
      expect(stored).not.toContain(secret);
    }
    const data = state.stored[0].data as Record<string, unknown>;
    expect(data.url).toBe('ember.example.com');
    expect(data).not.toHaveProperty('cookie');
    expect(data).not.toHaveProperty('accessToken');
    expect(data.nested).toEqual({ host: '10.0.2.2' });
    expect(state.stored[0].message).toContain('10.0.2.2');
  });
});
