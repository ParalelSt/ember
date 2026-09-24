// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { fakePocketBase, type FakePb } from '@/test-utils/fakePocketBase';
import { pbDate } from '@/lib/pranks/limits';

// Repeats (create, list, stop), Stop everything, and the people route's
// hourly count, against a fake admin client.

const who = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'member' | 'anon' }));
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  const requireAdmin = async () => {
    if (who.role === 'anon') throw new actual.UnauthorizedError();
    if (who.role === 'member') throw new actual.ForbiddenError();
    return { user: { id: 'root', email: 'root@x', isAdmin: true } };
  };
  return { ...actual, requireAdmin };
});
vi.mock('@/lib/rateLimit', () => ({ rateLimitResponse: () => null }));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_n: string, h: unknown) => h }));

let store: FakePb;
vi.mock('@/lib/pocketbase/server', () => ({ createAdminClient: async () => store.pb }));

const schedules = await import('./route');
const one = await import('./[id]/route');
const stopAll = await import('../stop-all/route');
const people = await import('../people/route');

const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`http://t${url}`, init);
const post = (body: unknown) =>
  schedules.POST(req('/api/admin/pranks/schedules', { method: 'POST', body: JSON.stringify(body) }), undefined as never);
const del = (id: string) =>
  one.DELETE(req(`/api/admin/pranks/schedules/${id}`, { method: 'DELETE' }), { params: Promise.resolve({ id }) } as never);
const table = (name: string) => store.rows.get(name) ?? [];
const inMin = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const good = (over: Record<string, unknown> = {}) => ({
  targetId: 'marko', soundId: 'quack', intervalSec: 120, endsAt: inMin(30), params: { mode: 'duck', volume: 0.7 }, ...over,
});

beforeEach(() => {
  who.role = 'admin';
  store = fakePocketBase({
    users: [
      { id: 'root', name: 'Aron', email: 'aron@x', is_admin: true },
      { id: 'marko', name: 'Marko', email: 'marko@x' },
    ],
    app_settings: [{ id: 's1', key: 'pranks', value: { enabled: true } }],
    pranks: [],
    prank_schedules: [],
    prank_sounds: [
      { id: 'quack', kind: 'sound', name: 'Duck quack', filename: 'a.wav' },
      { id: 'tune', kind: 'song', name: 'Old song', filename: 'b.wav' },
    ],
    plays: [],
  });
});

describe('POST /api/admin/pranks/schedules', () => {
  it('starts a repeat: due now, active, sound-only params, in words', async () => {
    const before = Date.now();
    const res = await post(good());
    expect(res.status).toBe(201);
    const { schedule } = await res.json();
    expect(schedule).toMatchObject({
      targetName: 'Marko', soundName: 'Duck quack', intervalSec: 120, fired: 0, mode: 'duck',
      line: '“Duck quack” for Marko, every 2 min',
    });
    const [row] = table('prank_schedules');
    expect(row).toMatchObject({ target: 'marko', issued_by: 'root', kind: 'sound', sound: 'quack', active: true, fired: 0, interval_sec: 120 });
    expect(row.params).toEqual({ durationSec: 30, volume: 0.7, mode: 'duck', startFrom: 'start' });
    const next = Date.parse(String(row.next_fire_at).replace(' ', 'T'));
    expect(next).toBeGreaterThanOrEqual(before - 1000);
    expect(next).toBeLessThanOrEqual(Date.now());
  });

  it('holds the interval to 60 s .. 2 h and the stop time to 2 h out, in words', async () => {
    expect((await (await post(good({ intervalSec: 30 }))).json()).error).toBe('Repeat every 1 minute to 2 hours');
    expect((await post(good({ endsAt: inMin(130) }))).status).toBe(400);
    expect((await post(good({ endsAt: inMin(-1) }))).status).toBe(400);
    expect((await post(good({ targetId: '' }))).status).toBe(400);
    expect(table('prank_schedules')).toHaveLength(0);
  });

  it('refuses an unknown person, a missing sound, or an old song file', async () => {
    expect((await post(good({ targetId: 'nobody' }))).status).toBe(404);
    expect((await post(good({ soundId: 'nope' }))).status).toBe(404);
    expect((await post(good({ soundId: 'tune' }))).status).toBe(404);
  });

  it('allows 3 running repeats per person, and says so on the 4th', async () => {
    for (let i = 0; i < 3; i++) expect((await post(good())).status).toBe(201);
    const res = await post(good());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('Marko already has 3 repeats running; stop one first');
  });

  it('refuses while the switch is off', async () => {
    table('app_settings')[0].value = { enabled: false };
    expect((await post(good())).status).toBe(409);
  });

  it('is admin only', async () => {
    who.role = 'member';
    expect((await post(good())).status).toBe(403);
    who.role = 'anon';
    expect((await schedules.GET(req('/x'), undefined as never)).status).toBe(401);
  });
});

describe('GET /api/admin/pranks/schedules', () => {
  it('lists only running repeats, in words', async () => {
    await post(good());
    table('prank_schedules').push({ id: 'old', target: 'marko', sound: 'quack', active: false, interval_sec: 60 } as never);
    const body = await (await schedules.GET(req('/x'), undefined as never)).json();
    expect(body.schedules.map((s: { line: string }) => s.line)).toEqual(['“Duck quack” for Marko, every 2 min']);
  });
});

describe('DELETE /api/admin/pranks/schedules/[id]', () => {
  it('stops the repeat and cancels only its waiting plays', async () => {
    const { schedule } = await (await post(good())).json();
    table('pranks').push(
      { id: 'mine', schedule: schedule.id, status: 'pending', kind: 'sound' } as never,
      { id: 'heard', schedule: schedule.id, status: 'done', kind: 'sound' } as never,
      { id: 'other', status: 'pending', kind: 'ping' } as never,
    );
    const res = await del(schedule.id);
    expect(await res.json()).toEqual({ ok: true, cancelled: 1 });
    expect(table('prank_schedules')[0].active).toBe(false);
    expect(Object.fromEntries(table('pranks').map((p) => [p.id, p.status]))).toEqual({ mine: 'cancelled', heard: 'done', other: 'pending' });
  });

  it('404s an unknown repeat', async () => {
    expect((await del('nope')).status).toBe(404);
  });
});

describe('POST /api/admin/pranks/stop-all', () => {
  it('stops every repeat and cancels every waiting prank, leaving the switch on', async () => {
    await post(good());
    await post(good());
    table('pranks').push(
      { id: 'a', status: 'pending', kind: 'sound' } as never,
      { id: 'b', status: 'delivered', kind: 'sound' } as never,
    );
    const res = await stopAll.POST(req('/x', { method: 'POST' }), undefined as never);
    expect(await res.json()).toEqual({ stopped: 2, cancelled: 1 });
    expect(table('prank_schedules').every((s) => s.active === false)).toBe(true);
    expect(table('pranks').map((p) => p.status)).toEqual(['cancelled', 'delivered']);
    expect(table('app_settings')[0].value).toEqual({ enabled: true });
  });

  it('is admin only', async () => {
    who.role = 'member';
    expect((await stopAll.POST(req('/x', { method: 'POST' }), undefined as never)).status).toBe(403);
  });
});

describe('GET /api/admin/pranks/people (hourly count)', () => {
  it('counts what the cap counts: heard or waiting sounds, not pings, not nothing-playing skips', async () => {
    const at = pbDate(Date.now() - 60_000);
    const exp = pbDate(Date.now() + 40_000);
    table('pranks').push(
      { id: '1', target: 'marko', kind: 'sound', status: 'done', created: at, expires_at: exp } as never,
      { id: '2', target: 'marko', kind: 'sound', status: 'pending', created: at, expires_at: exp } as never,
      { id: '3', target: 'marko', kind: 'ping', status: 'delivered', created: at, expires_at: exp } as never,
      { id: '4', target: 'marko', kind: 'sound', status: 'skipped', reason: 'not-playing', created: at, expires_at: exp } as never,
      { id: '5', target: 'marko', kind: 'sound', status: 'cancelled', created: at, expires_at: exp } as never,
    );
    const body = await (await people.GET(req('/x'), undefined as never)).json();
    const byId = Object.fromEntries(body.people.map((p: { id: string; hourCount: number }) => [p.id, p.hourCount]));
    expect(byId).toEqual({ marko: 2, root: 0 });
  });
});
