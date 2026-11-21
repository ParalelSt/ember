// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  session: {} as Row,
  tracks: [] as Row[],
  members: ['u2', 'u3'],
  deleted: [] as string[],
  sessionUpdates: [] as Row[],
}));
const caller = vi.hoisted(() => ({ id: 'u1' }));

const pb = {
  filter: (expr: string) => expr,
  collection: (name: string) => ({
    getOne: async () => ({ ...db.session }),
    getFirstListItem: async () => {
      if (name === 'session_members' && db.members.includes(caller.id)) return { id: 'm' };
      throw Object.assign(new Error('nf'), { status: 404 });
    },
    getFullList: async () => [...db.tracks].sort((a, b) => Number(a.position) - Number(b.position)),
    delete: async (id: string) => {
      db.deleted.push(id);
      db.tracks = db.tracks.filter((t) => t.id !== id);
      return true;
    },
    update: async (_id: string, data: Row) => {
      db.sessionUpdates.push(data);
      Object.assign(db.session, data);
      return {};
    },
  }),
};

vi.mock('@/lib/auth', () => ({
  requireUser: async () => ({ pb, user: { id: caller.id } }),
  ForbiddenError: class ForbiddenError extends Error {
    status = 403;
  },
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/pocketbase/server', () => ({ createAdminClient: async () => pb, createCatalogClient: async () => pb }));
vi.mock('@/lib/upsertTrack', () => ({
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: (e as { status?: number })?.status ?? 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_r: string, h: unknown) => h }));

const { DELETE } = await import('./route');

const call = (itemId: string) =>
  DELETE(new NextRequest('http://ember.test/x', { method: 'DELETE' }), {
    params: Promise.resolve({ id: 's1', itemId }),
  } as never);

beforeEach(() => {
  caller.id = 'u1';
  db.deleted = [];
  db.sessionUpdates = [];
  db.session = { id: 's1', host: 'u1', active: true, now_index: 2 };
  // Positions have gaps and are listed out of order on purpose: now_index
  // counts rows sorted by position.
  db.tracks = [
    { id: 'q4', position: 9, added_by: 'u2' },
    { id: 'q1', position: 1, added_by: 'u1' },
    { id: 'q2', position: 4, added_by: 'u2' },
    { id: 'q3', position: 5, added_by: 'u3' },
  ];
});

describe('DELETE /api/sessions/[id]/tracks/[itemId]', () => {
  it('the host removes any song', async () => {
    const res = await call('q4');
    expect(res.status).toBe(200);
    expect(db.deleted).toEqual(['q4']);
  });

  it('a member removes their own song', async () => {
    caller.id = 'u2';
    expect((await call('q4')).status).toBe(200);
    expect(db.deleted).toEqual(['q4']);
  });

  it("a member cannot remove someone else's song (403)", async () => {
    caller.id = 'u2';
    expect((await call('q1')).status).toBe(403);
    expect(db.deleted).toEqual([]);
  });

  it('a stranger who has not joined gets 403', async () => {
    caller.id = 'u9';
    expect((await call('q4')).status).toBe(403);
  });

  it('the song playing now cannot be removed (409), even by the host', async () => {
    // Sorted by position the third row is q3.
    const res = await call('q3');
    expect(res.status).toBe(409);
    expect(db.deleted).toEqual([]);
    expect(db.sessionUpdates).toEqual([]);
  });

  it('an ended carlist answers 410', async () => {
    db.session.active = false;
    expect((await call('q4')).status).toBe(410);
    expect(db.deleted).toEqual([]);
  });

  it('a row that is not in this carlist is 404', async () => {
    expect((await call('zzzzzz')).status).toBe(404);
    expect((await call('bad/id')).status).toBe(404);
    expect(db.deleted).toEqual([]);
  });

  it('removing a row before the playing one moves now_index down', async () => {
    const res = await call('q1');
    expect(await res.json()).toEqual({ ok: true, nowIndex: 1 });
    expect(db.sessionUpdates).toEqual([{ now_index: 1 }]);
  });

  it('removing a row after the playing one leaves now_index alone', async () => {
    await call('q4');
    expect(db.sessionUpdates).toEqual([]);
    expect(db.session.now_index).toBe(2);
  });
});
