// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// A tiny fake of the two collections the routes touch.
const db = vi.hoisted(() => ({
  rows: [] as { id: string; user: string; track: string; blocked_at: string }[],
  tracks: { 'youtube:x': 'rec-x' } as Record<string, string>,
  signedIn: true,
}));
const pb = {
  filter: (q: string, p: Record<string, string>) => q.replace(/\{:(\w+)\}/g, (_m, k) => `"${p[k]}"`),
  collection: (name: string) => ({
    create: async (r: { user: string; track: string; blocked_at: string }) => {
      if (db.rows.some((x) => x.user === r.user && x.track === r.track)) throw Object.assign(new Error('dup'), { status: 400 });
      db.rows.push({ id: `b${db.rows.length + 1}`, ...r });
    },
    getFullList: async () => [...db.rows].sort((a, b) => b.blocked_at.localeCompare(a.blocked_at)),
    delete: async (id: string) => {
      db.rows = db.rows.filter((r) => r.id !== id);
    },
    getFirstListItem: async (q: string) => {
      if (name === 'tracks') {
        const id = /"([^"]+)"/.exec(q)![1];
        if (!db.tracks[id]) throw Object.assign(new Error('nf'), { status: 404 });
        return { id: db.tracks[id] };
      }
      const [, user, track] = /"([^"]+)".*"([^"]+)"/.exec(q)!;
      const row = db.rows.find((r) => r.user === user && r.track === track);
      if (!row) throw Object.assign(new Error('nf'), { status: 404 });
      return row;
    },
  }),
};
const Unauthorized = vi.hoisted(() => class UnauthorizedError extends Error {});
vi.mock('@/lib/auth', () => ({
  requireUser: async () => {
    if (!db.signedIn) throw new Unauthorized();
    return { pb, user: { id: 'u1' } };
  },
  UnauthorizedError: Unauthorized,
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/upsertTrack', () => ({
  upsertCatalogTrack: async (t: { id: string }) => db.tracks[t.id] ?? (db.tracks[t.id] = `rec-${t.id}`),
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock('@/lib/blockedTracks', async (orig) => ({
  ...(await orig<typeof import('@/lib/blockedTracks')>()),
  listBlocked: async () => db.rows.map((r) => ({ id: r.track })),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_r: string, handler: unknown) => handler }));

const { GET, POST } = await import('./route');
const { DELETE } = await import('./[trackId]/route');

const post = (body: unknown) =>
  (POST as unknown as (r: NextRequest) => Promise<Response>)({ json: async () => body } as unknown as NextRequest);
const del = (trackId: string) =>
  (DELETE as unknown as (r: NextRequest, c: unknown) => Promise<Response>)({} as NextRequest, { params: Promise.resolve({ trackId }) });

beforeEach(() => {
  db.rows = [];
  db.signedIn = true;
});

describe('/api/blocked-tracks', () => {
  it('blocks a song once, however often it is asked', async () => {
    const track = { id: 'youtube:x', title: 'Bad' };
    expect((await post({ track })).status).toBe(201);
    expect((await post({ track })).status).toBe(201);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ user: 'u1', track: 'rec-x' });
  });

  it('refuses a body with no song', async () => {
    expect((await post({})).status).toBe(400);
  });

  it('lists what is blocked, and only for someone signed in', async () => {
    await post({ track: { id: 'youtube:x', title: 'Bad' } });
    expect(((await (GET as unknown as () => Promise<Response>)().then((r) => r.json())) as { tracks: unknown[] }).tracks).toHaveLength(1);
    db.signedIn = false;
    expect((await (GET as unknown as () => Promise<Response>)()).status).toBe(401);
  });

  it('unblocks, and unblocking something not blocked is fine', async () => {
    await post({ track: { id: 'youtube:x', title: 'Bad' } });
    expect((await del(encodeURIComponent('youtube:x'))).status).toBe(200);
    expect(db.rows).toHaveLength(0);
    expect((await del('youtube:nothing')).status).toBe(200);
  });
});
