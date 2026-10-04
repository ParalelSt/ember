// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// The carlist routes against a small in-memory PocketBase: joining by code
// (as the join link does), Play next / Add to end, the live-carlist lookup
// behind the Carlist button, and what the poll shows of people.

type Row = Record<string, unknown> & { id: string };
const db: Record<string, Row[]> = {};
const writes: string[] = [];
let seq = 0;

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  writes.length = 0;
  seq = 0;
  db.users = [
    { id: 'u1', name: 'Hana', email: 'hana@ember.test', collectionName: 'users', avatar: 'h.png' },
    { id: 'u2', name: '', email: 'marko@ember.test', collectionName: 'users' },
    { id: 'u3', name: 'Ines', email: 'ines@ember.test', collectionName: 'users' },
  ];
  db.tracks = [
    { id: 't1', source: 'youtube', source_id: 'aaaaaaaaaaa', title: 'One', artist: 'A', duration_sec: 200 },
    { id: 't2', source: 'youtube', source_id: 'bbbbbbbbbbb', title: 'Two', artist: 'B', duration_sec: 200 },
    { id: 't3', source: 'youtube', source_id: 'ccccccccccc', title: 'Three', artist: 'C', duration_sec: 200 },
  ];
  db.sessions = [
    { id: 's1', code: 'K7MPQ4', name: 'Road trip', host: 'u1', active: true, now_index: 0, updated: '2026-10-02 10:00:00.000Z' },
    { id: 's2', code: 'OLDONE', name: 'Old', host: 'u3', active: false, now_index: 0, updated: '2026-10-01 10:00:00.000Z' },
  ];
  db.session_members = [{ id: 'm1', session: 's1', user: 'u1', created: '1' }];
  db.session_tracks = [
    { id: 'st1', session: 's1', track: 't1', position: 1, added_by: 'u1', played: false },
    { id: 'st2', session: 's1', track: 't2', position: 2, added_by: 'u1', played: false },
    { id: 'st3', session: 's1', track: 't3', position: 3, added_by: 'u1', played: false },
  ];
  db.session_commands = [];
}

/** Very small filter matcher: `a = "x"` and `a = true` clauses joined by
 *  &&, plus the membership clause of the live lookup. */
function matches(row: Row, filter: string, name: string): boolean {
  const live = filter.match(/\(host = "(\w+)" \|\| session_members_via_session\.user \?= "(\w+)"\)/);
  if (live) {
    const u = live[1];
    const inIt = row.host === u || db.session_members.some((m) => m.session === row.id && m.user === u);
    if (!inIt) return false;
    filter = filter.replace(live[0], 'true');
  }
  for (const clause of filter.split('&&').map((c) => c.trim())) {
    if (clause === 'true') continue;
    let m = clause.match(/^(\w+) = "([^"]*)"$/);
    if (m) {
      if (String(row[m[1]]) !== m[2]) return false;
      continue;
    }
    m = clause.match(/^(\w+) = (true|false)$/);
    if (m) {
      if ((row[m[1]] === true) !== (m[2] === 'true')) return false;
      continue;
    }
    m = clause.match(/^updated >= "(.+)"$/);
    if (m) continue; // every fixture row counts as recent
    throw new Error(`fake pb: unsupported clause "${clause}" on ${name}`);
  }
  return true;
}

const expandRow = (row: Row, expand?: string): Row => {
  if (!expand) return { ...row };
  const out: Row = { ...row, expand: {} };
  for (const field of expand.split(',')) {
    const target = field === 'track' ? 'tracks' : 'users';
    const hit = db[target]?.find((r) => r.id === row[field]);
    if (hit) (out.expand as Record<string, unknown>)[field] = { ...hit, collectionName: target };
  }
  return out;
};

const notFound = () => Object.assign(new Error('not found'), { status: 404 });

function fakePb() {
  return {
    filter: (expr: string, params: Record<string, unknown>) =>
      expr.replace(/\{:(\w+)\}/g, (_m, k: string) => {
        const v = params[k];
        return v instanceof Date ? JSON.stringify(v.toISOString()) : JSON.stringify(String(v));
      }),
    collection: (name: string) => ({
      getOne: async (id: string, opts?: { expand?: string }) => {
        const row = db[name]?.find((r) => r.id === id);
        if (!row) throw notFound();
        return expandRow(row, opts?.expand);
      },
      getFirstListItem: async (filter: string) => {
        const row = db[name]?.find((r) => matches(r, filter, name));
        if (!row) throw notFound();
        return { ...row };
      },
      getFullList: async (opts: { filter?: string; sort?: string; expand?: string } = {}) => {
        let rows = (db[name] ?? []).filter((r) => !opts.filter || matches(r, opts.filter, name));
        if (opts.sort === 'position') rows = [...rows].sort((a, b) => Number(a.position) - Number(b.position));
        return rows.map((r) => expandRow(r, opts.expand));
      },
      getList: async (_page: number, perPage: number, opts: { filter?: string } = {}) => {
        const rows = (db[name] ?? []).filter((r) => !opts.filter || matches(r, opts.filter, name));
        return { items: rows.slice(0, perPage).map((r) => ({ ...r })) };
      },
      create: async (data: Record<string, unknown>) => {
        if (name === 'session_members' && db[name].some((m) => m.session === data.session && m.user === data.user)) {
          throw Object.assign(new Error('unique'), { status: 400 });
        }
        const row = { id: `${name}-${++seq}`, ...data } as Row;
        (db[name] ??= []).push(row);
        writes.push(`create:${name}`);
        return row;
      },
      update: async (id: string, data: Record<string, unknown>) => {
        const row = db[name].find((r) => r.id === id);
        if (!row) throw notFound();
        Object.assign(row, data);
        writes.push(`update:${name}:${id}`);
        return row;
      },
      delete: async (id: string) => {
        db[name] = db[name].filter((r) => r.id !== id);
        return true;
      },
    }),
  };
}

const caller = vi.hoisted(() => ({ id: 'u1' }));
vi.mock('@/lib/auth', () => ({
  requireUser: async () => ({ pb: fakePb(), user: { id: caller.id, email: 'x@ember.test', isAdmin: false } }),
  ForbiddenError: class ForbiddenError extends Error {
    status = 403;
  },
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/pocketbase/server', () => ({
  createAdminClient: async () => fakePb(),
  createCatalogClient: async () => fakePb(),
}));
vi.mock('@/lib/upsertTrack', () => ({
  upsertCatalogTrack: async (t: { id: string }) => (t.id === 'youtube:ddddddddddd' ? 't4' : 't1'),
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  fromError: (e: unknown) =>
    Response.json({ error: String((e as Error)?.message ?? e) }, { status: (e as { status?: number })?.status ?? 500 }),
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
const newTrack = { id: 'youtube:ddddddddddd', source: 'youtube', sourceId: 'ddddddddddd', title: 'Four', artist: 'D' };

type Handler = (r: NextRequest, c?: unknown) => Promise<Response>;
const handler = async (p: Promise<Record<string, unknown>>, method: 'POST' | 'GET' = 'POST') => (await p)[method] as Handler;
const addRoute = () => handler(import('./[id]/tracks/route'));
const order = () =>
  [...db.session_tracks]
    .filter((r) => r.session === 's1')
    .sort((a, b) => Number(a.position) - Number(b.position))
    .map((r) => `${r.track}@${r.position}`);

beforeEach(() => {
  reset();
  caller.id = 'u1';
});

describe('joining by the link code', () => {
  it('a guest joins with a code in any case or spacing, and is told its code', async () => {
    caller.id = 'u2';
    const POST = await handler(import('./join/route'));
    const res = await POST(req({ code: ' k7m-pq4 ' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ session: { id: 's1', name: 'Road trip', code: 'K7MPQ4' } });
    expect(db.session_members.some((m) => m.session === 's1' && m.user === 'u2')).toBe(true);
  });

  it('opening the link twice is fine (already in the car)', async () => {
    caller.id = 'u2';
    const POST = await handler(import('./join/route'));
    expect((await POST(req({ code: 'K7MPQ4' }))).status).toBe(200);
    expect((await POST(req({ code: 'K7MPQ4' }))).status).toBe(200);
    expect(db.session_members.filter((m) => m.user === 'u2')).toHaveLength(1);
  });

  it('an ended carlist, an unknown code or junk: 404; nothing: 400', async () => {
    caller.id = 'u2';
    const POST = await handler(import('./join/route'));
    expect((await POST(req({ code: 'OLDONE' }))).status).toBe(404);
    expect((await POST(req({ code: 'ZZZZZZ' }))).status).toBe(404);
    expect((await POST(req({ code: 'K7"||1' }))).status).toBe(404);
    expect((await POST(req({ code: '' }))).status).toBe(400);
    expect((await POST(req({}))).status).toBe(400);
    expect(db.session_members.some((m) => m.user === 'u2')).toBe(false);
  });
});

describe('adding: Play next or Add to end', () => {
  it('left out means the end, as before', async () => {
    const POST = await addRoute();
    const res = await POST(req({ track: newTrack }), ctx);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, position: 'end', ahead: 2 });
    expect(order()).toEqual(['t1@1', 't2@2', 't3@3', 't4@4']);
  });

  it('play next goes right after the playing song; the rest move down', async () => {
    db.sessions[0].now_index = 0;
    const POST = await addRoute();
    const res = await POST(req({ track: newTrack, position: 'next' }), ctx);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, position: 'next', ahead: 0 });
    expect(order()).toEqual(['t1@1', 't4@2', 't2@3', 't3@4']);
  });

  it('play next while the last song plays is the end', async () => {
    db.sessions[0].now_index = 2;
    const POST = await addRoute();
    const res = await POST(req({ track: newTrack, position: 'next' }), ctx);
    expect(await res.json()).toEqual({ ok: true, position: 'next', ahead: 0 });
    expect(order()).toEqual(['t1@1', 't2@2', 't3@3', 't4@4']);
  });

  it.each([['first'], [1], ['NEXT'], [{}], [true]])('refuses position %j with 400 and writes nothing', async (position) => {
    const POST = await addRoute();
    const res = await POST(req({ track: newTrack, position }), ctx);
    expect(res.status).toBe(400);
    expect(writes).toEqual([]);
  });

  it('a guest who joined can play next too (everyone is a DJ)', async () => {
    db.session_members.push({ id: 'm2', session: 's1', user: 'u2' });
    caller.id = 'u2';
    const POST = await addRoute();
    expect((await POST(req({ track: newTrack, position: 'next' }), ctx)).status).toBe(201);
    expect(db.session_tracks.find((r) => r.track === 't4')?.added_by).toBe('u2');
  });

  it('someone who never joined cannot add anywhere', async () => {
    caller.id = 'u3';
    const POST = await addRoute();
    expect((await POST(req({ track: newTrack, position: 'next' }), ctx)).status).toBe(403);
    expect(writes).toEqual([]);
  });

  it('an ended carlist takes no songs', async () => {
    db.sessions[0].active = false;
    const POST = await addRoute();
    expect((await POST(req({ track: newTrack, position: 'next' }), ctx)).status).toBe(410);
  });
});

describe('the live carlist behind the Carlist button', () => {
  it('the host sees theirs', async () => {
    const GET = await handler(import('./route'), 'GET');
    const res = await GET(req());
    expect(await res.json()).toEqual({ carlist: { id: 's1', code: 'K7MPQ4', name: 'Road trip', isHost: true } });
  });

  it('a guest who joined sees it too, not as host', async () => {
    db.session_members.push({ id: 'm2', session: 's1', user: 'u2' });
    caller.id = 'u2';
    const GET = await handler(import('./route'), 'GET');
    expect((await (await GET(req())).json()).carlist).toMatchObject({ id: 's1', isHost: false });
  });

  it('nobody else, and not an ended one', async () => {
    caller.id = 'u3';
    const GET = await handler(import('./route'), 'GET');
    expect(await (await GET(req())).json()).toEqual({ carlist: null });
  });
});

describe('the poll shows people by name, never email', () => {
  it('members host first, a missing name falls back like collab, and viewer ids', async () => {
    db.session_members.push({ id: 'm2', session: 's1', user: 'u2', created: '2' });
    db.session_tracks.push({ id: 'st4', session: 's1', track: 't2', position: 4, added_by: 'u2', played: false });
    caller.id = 'u2';
    const GET = await handler(import('./[id]/route'), 'GET');
    const body = await (await GET(req(), ctx)).json();
    expect(body.session).toMatchObject({ hostName: 'Hana', hostId: 'u1', isHost: false, viewerId: 'u2', nowIndex: 0 });
    expect(typeof body.session.nowElapsedMs).toBe('number');
    expect(body.members.map((m: { name: string }) => m.name)).toEqual(['Hana', 'Unnamed member']);
    expect(body.members[0].avatarUrl).toBe('/pb/api/files/users/u1/h.png');
    expect(body.queue.at(-1)).toMatchObject({ addedByName: 'Unnamed member', addedBy: { id: 'u2', name: 'Unnamed member' } });
    expect(JSON.stringify(body)).not.toContain('@ember.test');
  });
});

describe('the host moving on', () => {
  it('only a real change writes (its time is when the song started)', async () => {
    const POST = await handler(import('./[id]/now/route'));
    expect((await POST(req({ index: 0 }), ctx)).status).toBe(200);
    expect(writes).toEqual([]);
    expect((await POST(req({ index: 1 }), ctx)).status).toBe(200);
    expect(writes).toEqual(['update:sessions:s1']);
  });
});

describe('Skip from several phones', () => {
  const skipAs = async (user: string, body?: unknown) => {
    caller.id = user;
    const POST = await handler(import('./[id]/skip/route'));
    return POST(req(body), ctx);
  };
  const consume = async () => {
    caller.id = 'u1';
    const POST = await handler(import('./[id]/commands/consume/route'));
    return (await (await POST(req(), ctx)).json()) as { commands: { type: string }[] };
  };

  beforeEach(() => {
    db.session_members.push({ id: 'm2', session: 's1', user: 'u2', created: '2' });
    db.session_members.push({ id: 'm3', session: 's1', user: 'u3', created: '3' });
  });

  it('two people skipping the same song skip it once, not the next one too', async () => {
    expect((await skipAs('u2', { index: 0 })).status).toBe(201);
    expect((await skipAs('u3', { index: 0 })).status).toBeLessThan(300);
    expect((await consume()).commands).toEqual([{ type: 'skip' }]);
    expect(db.session_commands).toHaveLength(0);
  });

  it('a skip for a song that has already changed does nothing', async () => {
    db.sessions[0].now_index = 1;
    const res = await skipAs('u2', { index: 0 });
    expect(res.status).toBeLessThan(300);
    expect((await consume()).commands).toEqual([]);
  });

  it('an older app that sends no index still skips', async () => {
    expect((await skipAs('u2')).status).toBe(201);
    expect((await consume()).commands).toEqual([{ type: 'skip' }]);
  });
});
