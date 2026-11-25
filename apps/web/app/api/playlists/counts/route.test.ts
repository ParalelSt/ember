// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import PocketBase from 'pocketbase';
import { createWorld, type World } from '@/test-utils/fakePlaylistPb';

// Songs per playlist for the head unit's covers sidebar. The fake follows
// the real PocketBase rules (test-utils/fakePlaylistPb): a member's own
// session cannot read the rows of a playlist shared with them.

let world: World;
const caller = { id: '' };
let pbOverride: unknown = null;

class UnauthorizedError extends Error {}
vi.mock('@/lib/auth', () => ({
  requireUser: async () => {
    if (!caller.id) throw new UnauthorizedError();
    return { pb: pbOverride ?? world.member(caller.id), user: { id: caller.id, email: `${caller.id}@ember.test` } };
  },
  UnauthorizedError,
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
let serverOverride: unknown = null;
vi.mock('@/lib/pocketbase/server', () => ({ createCatalogClient: async () => serverOverride ?? world.server() }));
vi.mock('@/lib/upsertTrack', () => ({
  fromError: (e: { message?: string; status?: number }) =>
    Response.json({ error: e?.message ?? 'error' }, { status: e?.status ?? 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_r: string, h: unknown) => h }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const { GET } = await import('./route');

async function call(as: string) {
  caller.id = as;
  const res = await (GET as unknown as (req: NextRequest, ctx: never) => Promise<Response>)({} as NextRequest, undefined as never);
  return { status: res.status, body: await res.json() };
}

let owner: string, member: string, outsider: string;
let shared: string, diary: string, empty: string;

beforeEach(() => {
  serverOverride = null;
  pbOverride = null;
  world = createWorld();
  owner = world.addUser('Olga').id;
  member = world.addUser('Mia').id;
  outsider = world.addUser('Xan').id;
  shared = world.addPlaylist(owner, 'Road trip', { collaborative: true }).id;
  diary = world.addPlaylist(owner, 'Diary').id;
  empty = world.addPlaylist(member, 'Empty').id;
  const [a, b, c] = ['youtube:aaa', 'youtube:bbb', 'youtube:ccc'].map((id) => world.addTrack(id).id);
  world.addRow(shared, a, 1, owner);
  world.addRow(shared, b, 2, member);
  world.addRow(shared, c, 3, owner);
  world.addRow(diary, a, 1);
  world.addMember(shared, member);
});

describe('GET /api/playlists/counts', () => {
  it('counts the songs in each of your own playlists', async () => {
    const r = await call(owner);
    expect(r.status).toBe(200);
    expect(r.body.counts).toEqual({ [shared]: 3, [diary]: 1 });
  });

  it('counts a collaborative playlist shared with you, and your own empty one as 0', async () => {
    expect((await call(member)).body.counts).toEqual({ [empty]: 0, [shared]: 3 });
  });

  it('tells nobody else about anyone\'s playlists', async () => {
    expect((await call(outsider)).body.counts).toEqual({});
  });

  it('still counts your own playlists when the shared ones cannot be looked up', async () => {
    serverOverride = { collection: () => { throw new Error('down'); }, filter: () => '' };
    expect((await call(member)).body.counts).toEqual({ [empty]: 0 });
  });

  it('is for signed-in members only', async () => {
    expect((await call('')).status).toBe(401);
  });
});

// The fakes above never cancel anything, but the real SDK does: two requests
// to the same collection at once on one client share a request key, and the
// earlier one is aborted. This runs the route on the real SDK over a stubbed
// fetch that honours the abort signal.
describe('GET /api/playlists/counts on the real PocketBase SDK', () => {
  it('counts every playlist when there are several (no request is auto-cancelled)', async () => {
    const ids = ['p1', 'p2', 'p3', 'p4'];
    const totals: Record<string, number> = { p1: 3, p2: 0, p3: 7, p4: 1 };
    const stub = vi.fn(async (input: unknown, init?: { signal?: AbortSignal }) => {
      const url = new URL(String(input), 'http://pb.test');
      await new Promise((r) => setTimeout(r, 5));
      if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.pathname.endsWith('/collections/playlists/records')) {
        return json({ page: 1, perPage: 500, totalItems: 4, totalPages: 1, items: ids.map((id) => ({ id })) });
      }
      const id = /playlist = '(\w+)'/.exec(url.searchParams.get('filter') ?? '')?.[1] ?? '';
      return json({ page: 1, perPage: 1, totalItems: totals[id], totalPages: totals[id], items: [] });
    });
    vi.stubGlobal('fetch', stub);
    try {
      pbOverride = new PocketBase('http://pb.test');
      serverOverride = { collection: () => { throw new Error('down'); }, filter: () => '' };
      const r = await call(owner);
      expect(r.status).toBe(200);
      expect(r.body.counts).toEqual(totals);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
