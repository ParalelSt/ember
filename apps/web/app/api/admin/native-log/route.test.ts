// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { ServerLogEntry } from '@/lib/logger/types';

/** GET /api/admin/native-log: the car and Android Auto log, per device,
 *  newest first, admins only. */

const state = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'member' | 'anon', entries: [] as ServerLogEntry[], since: 0 }));

vi.mock('@/lib/auth', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthorizedError,
    ForbiddenError,
    requireAdmin: async () => {
      if (state.role === 'anon') throw new UnauthorizedError();
      if (state.role === 'member') throw new ForbiddenError();
      return { user: { id: 'admin' } };
    },
    unauthorizedResponse: () => Response.json({ error: 'Sign in.' }, { status: 401 }),
    forbiddenResponse: () => Response.json({ error: 'Admins only.' }, { status: 403 }),
  };
});
vi.mock('@/lib/logger/server', () => ({
  serverLogger: {
    entriesSince: async (since: number) => {
      state.since = since;
      return state.entries;
    },
  },
}));
vi.mock('@/lib/upsertTrack', () => ({
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { GET } = await import('./route');

const get = (qs = '') => GET(new Request(`http://localhost/api/admin/native-log${qs}`) as unknown as NextRequest, undefined as never);

function entry(over: Partial<ServerLogEntry> & { event?: string; model?: string } = {}): ServerLogEntry {
  const { event = 'state', model = 'Google Pixel 8', ...rest } = over;
  return {
    ts: 1000,
    kind: 'breadcrumb',
    level: 'info',
    category: 'native',
    message: 'ready',
    sessionId: 'native:s1',
    side: 'server',
    reqId: 'r',
    route: 'native-log',
    userId: 'u1',
    surface: 'phone',
    data: { event, device: { model, sdk: 34, app: '0.4.17' } },
    ...rest,
  };
}

beforeEach(() => {
  state.role = 'admin';
  state.entries = [];
});

describe('GET /api/admin/native-log', () => {
  it('is for admins only', async () => {
    state.role = 'anon';
    expect((await get()).status).toBe(401);
    state.role = 'member';
    expect((await get()).status).toBe(403);
  });

  it('groups native entries per device, the latest device and event first, with exits', async () => {
    state.entries = [
      entry({ ts: 100, message: 'old phone event' }),
      entry({ ts: 300, model: 'Google sdk_gcar', surface: 'aaos', level: 'error', kind: 'error', event: 'exit', message: 'last run ended: anr', data: { event: 'exit', reason: 'anr', device: { model: 'Google sdk_gcar', sdk: 34 } } }),
      entry({ ts: 200, model: 'Google sdk_gcar', surface: 'aaos', level: 'warn', kind: 'error', event: 'play.stalled', message: 'play did not start within 8 s' }),
      // Not native: left out.
      entry({ ts: 400, category: 'api', message: 'GET x -> 500' }),
    ];
    const body = await (await get()).json();
    expect(body.hours).toBe(48);
    expect(body.devices).toHaveLength(2);
    const [car, phone] = body.devices;
    expect(car).toMatchObject({ model: 'Google sdk_gcar', surfaces: ['aaos'], counts: { error: 1, warn: 1, info: 0 } });
    expect(car.events.map((e: { ts: number }) => e.ts)).toEqual([300, 200]);
    expect(car.exits[0]).toMatchObject({ event: 'exit', message: 'last run ended: anr', data: { reason: 'anr' } });
    expect(phone.model).toBe('Google Pixel 8');
  });

  it('filters by surface and window', async () => {
    state.entries = [entry({ surface: 'phone' }), entry({ surface: 'android-auto', model: 'Pixel 7' })];
    const body = await (await get('?surface=android-auto&hours=24')).json();
    expect(body.devices.map((d: { model: string }) => d.model)).toEqual(['Pixel 7']);
    expect(body.hours).toBe(24);
    expect(Date.now() - state.since).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
    expect(Date.now() - state.since).toBeLessThan(25 * 60 * 60 * 1000);
  });

  it('refuses an unknown surface', async () => {
    expect((await get('?surface=tv')).status).toBe(400);
  });
});
