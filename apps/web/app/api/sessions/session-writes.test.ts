// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Carlist rows are server-written only (bughunt X2,
// pocketbase/pb_hooks/ensure_sessions.pb.js): a member's own PocketBase
// session may not create, change or delete sessions, queue rows, commands or
// roster rows, and cannot see a carlist it has not joined. The routes check
// host or membership themselves and then use the server's client. Here the
// member's client refuses exactly what the new rules refuse, so a route that
// still writes with it fails.

type Row = Record<string, unknown>;
const SESSION = { id: 's1', code: 'ABC234', name: 'Trip', host: 'u1', active: true, now_index: 0 };
const SESSION_COLLECTIONS = ['sessions', 'session_tracks', 'session_commands', 'session_members'];

const serverWrites: string[] = [];
const memberWrites: string[] = [];

function fakePb(kind: 'server' | 'member') {
  const writes = kind === 'server' ? serverWrites : memberWrites;
  const refused = (name: string) => kind === 'member' && SESSION_COLLECTIONS.includes(name);
  const deny = (status: number) => Promise.reject(Object.assign(new Error('refused'), { status }));
  return {
    collection: (name: string) => ({
      getOne: async (id: string): Promise<Row> => {
        if (refused(name)) return deny(404);
        if (name === 'playlists') return { id, user: 'u1' };
        return { ...SESSION, id, expand: { host: { name: 'Hana' } } };
      },
      getFirstListItem: async (): Promise<Row> => {
        if (refused(name)) return deny(404);
        if (name === 'sessions') return { ...SESSION };
        if (name === 'session_tracks') return { id: 'st1', position: 2 };
        return { id: 'row1' };
      },
      getFullList: async (): Promise<Row[]> => {
        if (refused(name)) return [];
        if (name === 'session_commands') return [{ id: 'c1', type: 'skip' }];
        if (name === 'session_tracks' || name === 'playlist_tracks') return [{ id: 'st1', track: 't1', position: 1 }];
        return [];
      },
      create: async (data: Row): Promise<Row> => {
        if (refused(name)) return deny(403);
        writes.push(`create:${name}`);
        return { id: `${name}-new`, ...data };
      },
      update: async (id: string, data: Row): Promise<Row> => {
        if (refused(name)) return deny(404);
        writes.push(`update:${name}`);
        return { id, ...data };
      },
      delete: async (): Promise<boolean> => {
        if (refused(name)) return deny(404);
        writes.push(`delete:${name}`);
        return true;
      },
    }),
  };
}

const caller = vi.hoisted(() => ({ id: 'u1' }));
vi.mock('@/lib/auth', () => ({
  requireUser: async () => ({ pb: fakePb('member'), user: { id: caller.id, email: 'x@ember.test', isAdmin: false } }),
  ForbiddenError: class ForbiddenError extends Error {
    status = 403;
  },
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/pocketbase/server', () => ({
  createAdminClient: async () => fakePb('server'),
  createCatalogClient: async () => fakePb('server'),
}));
vi.mock('@/lib/upsertTrack', () => ({
  upsertCatalogTrack: async () => 't1',
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  fromError: (e: unknown) =>
    Response.json({ error: String(e) }, { status: (e as { status?: number })?.status ?? 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const req = (body?: unknown) =>
  new NextRequest('http://ember.test/api/sessions', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
const ctx = { params: Promise.resolve({ id: 's1' }) };
const track = { id: 'youtube:abcdefghijk', source: 'youtube', sourceId: 'abcdefghijk', title: 'Song', artist: 'A' };

type Handler = (r: NextRequest, c?: unknown) => Promise<Response>;
const route = async (p: Promise<{ POST?: unknown; GET?: unknown }>, method: 'POST' | 'GET' = 'POST') =>
  (await p)[method] as Handler;

beforeEach(() => {
  serverWrites.length = 0;
  memberWrites.length = 0;
  caller.id = 'u1';
});

describe('carlist routes write through the server (X2)', () => {
  it('the host starts one, seeded from a playlist', async () => {
    const POST = await route(import('./route'));
    const res = await POST(req({ name: 'Trip', seedPlaylistId: 'p1' }));
    expect(res.status).toBe(201);
    expect(serverWrites).toEqual(['create:sessions', 'create:session_members', 'create:session_tracks']);
  });

  it('a guest joins with the code', async () => {
    caller.id = 'u2';
    const POST = await route(import('./join/route'));
    const res = await POST(req({ code: 'abc234' }));
    expect(res.status).toBe(200);
    expect(serverWrites).toEqual(['create:session_members']);
  });

  it('a guest reads it, adds a song, skips and keeps the mix', async () => {
    caller.id = 'u2';
    const GET = await route(import('./[id]/route'), 'GET');
    expect((await GET(req(), ctx)).status).toBe(200);
    const add = await route(import('./[id]/tracks/route'));
    expect((await add(req({ track }), ctx)).status).toBe(201);
    const skip = await route(import('./[id]/skip/route'));
    expect((await skip(req(), ctx)).status).toBe(201);
    const save = await route(import('./[id]/save/route'));
    expect((await save(req({ name: 'Kept' }), ctx)).status).toBe(201);
    expect(serverWrites).toEqual(['create:session_tracks', 'create:session_commands']);
    // The kept playlist is the guest's own, written with their session.
    expect(memberWrites).toContain('create:playlists');
  });

  it('the host takes the skips, moves on and ends it', async () => {
    const consume = await route(import('./[id]/commands/consume/route'));
    const res = await consume(req(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ commands: [{ type: 'skip' }] });
    const now = await route(import('./[id]/now/route'));
    expect((await now(req({ index: 1 }), ctx)).status).toBe(200);
    const end = await route(import('./[id]/end/route'));
    expect((await end(req(), ctx)).status).toBe(200);
    expect(serverWrites).toEqual(['delete:session_commands', 'update:sessions', 'update:sessions']);
  });

  it('someone who never joined is still refused', async () => {
    caller.id = 'u3';
    const { assertMember } = await import('@/lib/sessions');
    const refusingServer = {
      collection: () => ({
        getFirstListItem: () => Promise.reject(Object.assign(new Error('none'), { status: 404 })),
      }),
    };
    await expect(assertMember(refusingServer as never, { ...SESSION } as never, 'u3')).rejects.toMatchObject({ status: 403 });
  });
});
