// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { fakePocketBase, type FakePb } from '@/test-utils/fakePocketBase';
import { pbDate } from '@/lib/pranks/limits';

// The target's prank routes: inbox (own pending rows only), ack (own rows,
// forward moves only), presence heartbeat.

const who = vi.hoisted(() => ({ id: 'marko' as string | null, limited: false }));
let store: FakePb;
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  const requireUser = async () => {
    if (!who.id) throw new actual.UnauthorizedError();
    return { pb: store.pb, user: { id: who.id, email: `${who.id}@x`, isAdmin: false } };
  };
  return { ...actual, requireUser };
});
vi.mock('@/lib/rateLimit', () => ({
  rateLimitResponse: () => (who.limited ? Response.json({ error: 'Slow down' }, { status: 429 }) : null),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_n: string, h: unknown) => h }));
vi.mock('@/lib/pocketbase/server', () => ({ createAdminClient: async () => store.pb }));

const inbox = await import('./inbox/route');
const ack = await import('./[id]/route');
const presence = await import('./presence/route');
const { presenceStore } = await import('@/lib/pranks/presence');

const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`http://t${url}`, init);
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const patch = (id: string, body: unknown) =>
  ack.PATCH(req(`/api/pranks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }), idCtx(id));
const row = (id: string) => store.rows.get('pranks')!.find((r) => r.id === id)!;

beforeEach(() => {
  who.id = 'marko';
  who.limited = false;
  presenceStore().clear();
  const now = Date.now();
  store = fakePocketBase({
    pranks: [
      { id: 'mine', target: 'marko', issued_by: 'root', kind: 'ping', status: 'pending', params: {},
        created: pbDate(now - 2000), expires_at: pbDate(now + 40_000) },
      { id: 'late', target: 'marko', issued_by: 'root', kind: 'ping', status: 'pending', params: {},
        created: pbDate(now - 60_000), expires_at: pbDate(now - 15_000) },
      { id: 'done', target: 'marko', issued_by: 'root', kind: 'ping', status: 'delivered', params: {},
        created: pbDate(now - 9000), expires_at: pbDate(now + 36_000) },
      { id: 'theirs', target: 'ivana', issued_by: 'root', kind: 'ping', status: 'pending', params: {},
        created: pbDate(now - 1000), expires_at: pbDate(now + 44_000) },
    ],
  });
});

describe('GET /api/pranks/inbox', () => {
  it('returns only my pending pranks inside their window, without who sent them', async () => {
    const body = await (await inbox.GET(req('/api/pranks/inbox'), undefined as never)).json();
    expect(body.pranks.map((p: { id: string }) => p.id)).toEqual(['mine']);
    expect(body.pranks[0]).toEqual({
      id: 'mine', kind: 'ping', streamUrl: null, expiresAt: row('mine').expires_at,
      params: { durationSec: 0, volume: 1, mode: 'over', startFrom: 'start' },
    });
    expect(JSON.stringify(body)).not.toContain('root');
  });

  it('needs a session and honours the limiter', async () => {
    who.id = null;
    expect((await inbox.GET(req('/x'), undefined as never)).status).toBe(401);
    who.id = 'marko';
    who.limited = true;
    expect((await inbox.GET(req('/x'), undefined as never)).status).toBe(429);
  });
});

describe('PATCH /api/pranks/[id]', () => {
  it('marks my prank delivered, with the engine and version', async () => {
    const res = await patch('mine', { status: 'delivered', engine: 'web', appVersion: '0.5.0' });
    expect(res.status).toBe(200);
    expect(row('mine')).toMatchObject({ status: 'delivered', engine: 'web', app_version: '0.5.0' });
    expect(row('mine').delivered_at).toBeTruthy();
  });

  it('then done with the seconds it ran', async () => {
    expect((await patch('done', { status: 'done', playedSec: 7 })).status).toBe(200);
    expect(row('done')).toMatchObject({ status: 'done', played_sec: 7 });
  });

  it("answers 404 for someone else's prank and leaves it alone", async () => {
    expect((await patch('theirs', { status: 'delivered' })).status).toBe(404);
    expect(row('theirs').status).toBe('pending');
    expect((await patch('nope', { status: 'delivered' })).status).toBe(404);
  });

  it('answers 410 for a late ack and records the expiry', async () => {
    expect((await patch('late', { status: 'delivered' })).status).toBe(410);
    expect(row('late').status).toBe('expired');
  });

  it('refuses backward or skipped moves with 409, and a missing status with 400', async () => {
    expect((await patch('done', { status: 'delivered' })).status).toBe(409);
    expect((await patch('mine', { status: 'done' })).status).toBe(409);
    expect((await patch('mine', {})).status).toBe(400);
  });
});

describe('POST /api/pranks/presence', () => {
  it('records the heartbeat in memory for the admin page', async () => {
    const body = { track: { id: 'youtube:a', title: 'Song', artist: 'Band', durationSec: 200 }, position: 12, isPlaying: true, engine: 'web', appVersion: '0.5.0' };
    const res = await presence.POST(req('/x', { method: 'POST', body: JSON.stringify(body) }), undefined as never);
    expect(res.status).toBe(200);
    expect(presenceStore().get('marko', Date.now())).toMatchObject({ isPlaying: true, track: { title: 'Song' } });
  });

  it('rejects a body that is not a heartbeat, and anonymous callers', async () => {
    expect((await presence.POST(req('/x', { method: 'POST', body: '"hi"' }), undefined as never)).status).toBe(400);
    who.id = null;
    expect((await presence.POST(req('/x', { method: 'POST', body: '{}' }), undefined as never)).status).toBe(401);
  });
});
