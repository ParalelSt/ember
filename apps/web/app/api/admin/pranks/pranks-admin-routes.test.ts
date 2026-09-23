// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { fakePocketBase, type FakePb } from '@/test-utils/fakePocketBase';
import { pbDate } from '@/lib/pranks/limits';

// The admin prank routes (create, log, switch, people) against a fake admin
// client. Auth and the burst limiter are stubbed so each case controls them.

const who = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'member' | 'anon', limited: false }));
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  const requireAdmin = async () => {
    if (who.role === 'anon') throw new actual.UnauthorizedError();
    if (who.role === 'member') throw new actual.ForbiddenError();
    return { user: { id: 'root', email: 'root@x', isAdmin: true } };
  };
  return { ...actual, requireAdmin };
});
vi.mock('@/lib/rateLimit', () => ({
  rateLimitResponse: () => (who.limited ? Response.json({ error: 'Slow down' }, { status: 429 }) : null),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_n: string, h: unknown) => h }));

let store: FakePb;
vi.mock('@/lib/pocketbase/server', () => ({ createAdminClient: async () => store.pb }));

const create = await import('./route');
const settings = await import('./settings/route');
const people = await import('./people/route');
const { presenceStore } = await import('@/lib/pranks/presence');

const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`http://t${url}`, init);
const post = (body: unknown) =>
  create.POST(req('/api/admin/pranks', { method: 'POST', body: JSON.stringify(body) }), undefined as never);
const rows = () => store.rows.get('pranks') ?? [];

beforeEach(() => {
  who.role = 'admin';
  who.limited = false;
  presenceStore().clear();
  store = fakePocketBase({
    users: [
      { id: 'root', name: 'Aron', email: 'aron@x', is_admin: true },
      { id: 'marko', name: 'Marko', email: 'marko@x' },
      { id: 'ivana', name: '', email: 'ivana@x' },
    ],
    app_settings: [{ id: 's1', key: 'pranks', value: { enabled: true } }],
    pranks: [],
    prank_schedules: [],
    prank_sounds: [
      { id: 'quack', kind: 'sound', name: 'Duck quack', filename: 'a.wav' },
      { id: 'tune', kind: 'song', name: 'Wrong song', filename: 'b.wav' },
    ],
    plays: [],
  });
});

describe('POST /api/admin/pranks', () => {
  it('creates a pending ping that expires in 45 s', async () => {
    const before = Date.now();
    const res = await post({ targetId: 'marko', kind: 'ping' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.prank).toMatchObject({ kind: 'ping', status: 'pending', targetName: 'Marko' });
    expect(body.prank.line).toBe('You pinged Marko: waiting for their app');
    const [row] = rows();
    expect(row).toMatchObject({ target: 'marko', issued_by: 'root', kind: 'ping', status: 'pending' });
    const expires = Date.parse(String(row.expires_at).replace(' ', 'T'));
    expect(expires - before).toBeGreaterThanOrEqual(45_000);
    expect(expires - before).toBeLessThan(47_000);
  });

  it('refuses members and signed-out callers', async () => {
    who.role = 'member';
    expect((await post({ targetId: 'marko', kind: 'ping' })).status).toBe(403);
    who.role = 'anon';
    expect((await post({ targetId: 'marko', kind: 'ping' })).status).toBe(401);
    expect(rows()).toHaveLength(0);
  });

  it('answers 429 when the burst limiter says so', async () => {
    who.limited = true;
    expect((await post({ targetId: 'marko', kind: 'ping' })).status).toBe(429);
  });

  it('validates the body, and holds swaps until the swap engine exists', async () => {
    expect((await post({ kind: 'ping' })).status).toBe(400);
    expect((await post({ targetId: 'marko', kind: 'explode' })).status).toBe(400);
    expect((await post({ targetId: 'marko', kind: 'sound' })).status).toBe(400);
    expect((await post({ targetId: 'marko', kind: 'swap', soundId: 'tune' })).status).toBe(400);
    expect((await post({ targetId: 'nobody', kind: 'ping' })).status).toBe(404);
    expect(rows()).toHaveLength(0);
  });

  it('sends a library sound: the row names it and carries a server-set relative media URL', async () => {
    const res = await post({
      targetId: 'marko', kind: 'sound', soundId: 'quack',
      params: { mode: 'duck', volume: 0.6, streamUrl: 'https://evil.example/x.mp3' },
    });
    expect(res.status).toBe(201);
    expect((await res.json()).prank.line).toBe('You played a sound for Marko: waiting for their app');
    const [row] = rows();
    expect(row).toMatchObject({ kind: 'sound', sound: 'quack', status: 'pending' });
    expect(row.params).toEqual({
      durationSec: 30, volume: 0.6, mode: 'duck', startFrom: 'start', streamUrl: '/api/pranks/media/quack',
    });
  });

  it('refuses a missing sound, or a swap song played as a sound', async () => {
    expect((await post({ targetId: 'marko', kind: 'sound', soundId: 'nope' })).status).toBe(404);
    expect((await post({ targetId: 'marko', kind: 'sound', soundId: 'tune' })).status).toBe(404);
    expect(rows()).toHaveLength(0);
  });

  it('keeps 15 s between two sounds on one person, in words', async () => {
    const now = Date.now();
    store.rows.get('pranks')!.push({
      id: 'recent', target: 'marko', issued_by: 'root', kind: 'sound', status: 'done',
      created: pbDate(now - 5000), expires_at: pbDate(now + 40_000),
    } as never);
    const res = await post({ targetId: 'marko', kind: 'sound', soundId: 'quack' });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/^Sounds need 15 s between them; try again in \d+ s$/);
    // Someone else is fair game.
    expect((await post({ targetId: 'ivana', kind: 'sound', soundId: 'quack' })).status).toBe(201);
  });

  it('refuses with 409 while the switch is off', async () => {
    store.rows.get('app_settings')![0].value = { enabled: false };
    const res = await post({ targetId: 'marko', kind: 'ping' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('Pranks are switched off');
  });

  it('PRANKS_ENABLED=0 forces it off', async () => {
    process.env.PRANKS_ENABLED = '0';
    try {
      expect((await post({ targetId: 'marko', kind: 'ping' })).status).toBe(409);
    } finally {
      delete process.env.PRANKS_ENABLED;
    }
  });

  it('caps an admin at 60 an hour, in words, with Retry-After', async () => {
    const now = Date.now();
    for (let i = 0; i < 60; i++) {
      store.rows.get('pranks')!.push({
        id: `old${i}`, collectionId: 'pranks', collectionName: 'pranks', target: 'ivana', issued_by: 'root', kind: 'ping',
        status: 'delivered', created: pbDate(now - (i + 1) * 1000), expires_at: pbDate(now + 1000),
      } as never);
    }
    const res = await post({ targetId: 'marko', kind: 'ping' });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect((await res.json()).error).toMatch(/^You have sent 60 pranks this hour; try again in/);
  });
});

describe('GET /api/admin/pranks (log)', () => {
  it('lists newest first in words and writes back expired rows', async () => {
    const now = Date.now();
    store.rows.get('pranks')!.push(
      { id: 'a', target: 'marko', issued_by: 'root', kind: 'ping', status: 'delivered', engine: 'tauri-native',
        created: pbDate(now - 5000), expires_at: pbDate(now + 40_000) } as never,
      { id: 'b', target: 'ivana', issued_by: 'root', kind: 'ping', status: 'pending',
        created: pbDate(now - 60_000), expires_at: pbDate(now - 15_000) } as never,
    );
    const res = await create.GET(req('/api/admin/pranks'), undefined as never);
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.pranks.map((p: { line: string }) => p.line)).toEqual([
      'Aron pinged Marko: delivered on desktop',
      'Aron pinged ivana: not delivered: offline, paused, or app too old',
    ]);
    expect(rows().find((r) => r.id === 'b')?.status).toBe('expired');
  });

  it('filters to one person', async () => {
    store.rows.get('pranks')!.push(
      { id: 'a', target: 'marko', issued_by: 'root', kind: 'ping', status: 'done', created: pbDate(Date.now()), expires_at: '' } as never,
      { id: 'b', target: 'ivana', issued_by: 'root', kind: 'ping', status: 'done', created: pbDate(Date.now()), expires_at: '' } as never,
    );
    const body = await (await create.GET(req('/api/admin/pranks?target=ivana'), undefined as never)).json();
    expect(body.pranks.map((p: { id: string }) => p.id)).toEqual(['b']);
  });

  it('is admin only', async () => {
    who.role = 'member';
    expect((await create.GET(req('/api/admin/pranks'), undefined as never)).status).toBe(403);
  });
});

describe('/api/admin/pranks/settings', () => {
  it('turning off cancels pending pranks and stops schedules', async () => {
    store.rows.get('pranks')!.push({ id: 'p', target: 'marko', status: 'pending', kind: 'ping' } as never);
    store.rows.get('prank_schedules')!.push({ id: 'sc', target: 'marko', active: true } as never);
    const res = await settings.PATCH(req('/x', { method: 'PATCH', body: JSON.stringify({ enabled: false }) }), undefined as never);
    expect(await res.json()).toEqual({ enabled: false, cancelled: 1 });
    expect(rows()[0].status).toBe('cancelled');
    expect(store.rows.get('prank_schedules')![0].active).toBe(false);

    const back = await settings.PATCH(req('/x', { method: 'PATCH', body: JSON.stringify({ enabled: true }) }), undefined as never);
    expect((await back.json()).enabled).toBe(true);
    expect((await (await settings.GET(req('/x'), undefined as never)).json()).enabled).toBe(true);
  });

  it('rejects a body without a boolean, and members', async () => {
    const bad = await settings.PATCH(req('/x', { method: 'PATCH', body: JSON.stringify({ enabled: 'no' }) }), undefined as never);
    expect(bad.status).toBe(400);
    who.role = 'member';
    expect((await settings.GET(req('/x'), undefined as never)).status).toBe(403);
  });
});

describe('GET /api/admin/pranks/people', () => {
  it('shows each person in words: heartbeat, recent play, or nothing', async () => {
    const now = Date.now();
    presenceStore().record('marko', {
      track: { id: 'youtube:abc123', title: 'Song X', artist: 'Band Y', durationSec: 225 },
      position: 83, isPlaying: true, engine: 'android', appVersion: '0.5.0',
    }, now);
    store.rows.get('plays')!.push({
      id: 'pl1', user: 'ivana', played_at: pbDate(now - 12 * 60_000),
      expand: { track: { id: 't', external_id: 'upload:xyz', source: 'upload', source_id: 'xyz', title: 'Old One', artist: 'Z' } },
    } as never);

    const body = await (await people.GET(req('/x'), undefined as never)).json();
    const byId = Object.fromEntries(body.people.map((p: { id: string }) => [p.id, p]));
    expect(body.people[0].id).toBe('marko');
    expect(byId.marko).toMatchObject({ name: 'Marko', listening: true });
    expect(byId.marko.line).toMatch(/^Playing “Song X” by Band Y, 1:2\d of 3:45, on Android$/);
    expect(byId.ivana).toMatchObject({ name: 'ivana', listening: false, line: 'Was playing “Old One” by Z, 12 min ago' });
    expect(byId.root.line).toBe('Not listening');
    expect(JSON.stringify(body)).not.toMatch(/abc123|upload:xyz/);
  });

  it('is admin only', async () => {
    who.role = 'anon';
    expect((await people.GET(req('/x'), undefined as never)).status).toBe(401);
  });
});
