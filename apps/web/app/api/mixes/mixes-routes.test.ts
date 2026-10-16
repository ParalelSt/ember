// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { tt } from '@/test-utils/mixTracks';

// GET /api/mixes and /api/mixes/[key] against a stub PocketBase that
// applies the collection's rule (a member sees only their own rows), a stub
// job and a dead-song list.

const rows = [
  { id: 'a', user: 'u1', key: 'rock-metal', title: 'Rock & Metal', subtitle: 'Gojira, Tool and more', position: 0, tracks: [tt('a1', 'Gojira'), tt('a2', 'Tool')], cover: { artworkUrls: ['x'], color: '#f2b8a8' }, built_at: '2026-10-16T04:00:00.000Z' },
  { id: 'b', user: 'u1', key: 'pop', title: 'Pop', subtitle: 'Dua and more', position: 1, tracks: [tt('b1', 'Dua')], cover: { artworkUrls: [], color: '#f7c1dc' }, built_at: '2026-10-16T04:00:00.000Z' },
  { id: 'c', user: 'u2', key: 'balkan', title: 'Balkan', subtitle: 'Ceca and more', position: 0, tracks: [tt('c1', 'Ceca')], cover: {}, built_at: '' },
];
const state = vi.hoisted(() => ({ userId: 'u1', signedIn: true, dead: new Set<string>(), requestBuild: vi.fn(() => false), lastResult: vi.fn(() => null as null | { eligible: boolean }) }));

// The stub honours the list/view rule: only the signed-in member's rows.
const own = () => rows.filter((r) => r.user === state.userId);
const match = (filter: string) => {
  const key = /key = "([^"]+)"/.exec(filter)?.[1];
  const user = /user = "([^"]+)"/.exec(filter)?.[1];
  return own().filter((r) => (!user || r.user === user) && (!key || r.key === key));
};
const pb = {
  collection: () => ({
    getFullList: async ({ filter }: { filter: string }) => match(filter),
    getFirstListItem: async (filter: string) => {
      const hit = match(filter)[0];
      if (!hit) throw Object.assign(new Error('not found'), { status: 404 });
      return hit;
    },
  }),
};

vi.mock('@/lib/auth', () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    requireUser: async () => {
      if (!state.signedIn) throw new UnauthorizedError();
      return { pb, user: { id: state.userId, email: '', isAdmin: false } };
    },
    unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  };
});
vi.mock('@/lib/mixes/instance', () => ({ mixJob: () => ({ requestBuild: state.requestBuild, lastResult: state.lastResult }) }));
vi.mock('@/lib/trackAvailability', () => ({ listUnavailableIds: async () => state.dead }));
vi.mock('@/lib/upsertTrack', () => ({
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_r: string, h: unknown) => h }));

const { GET: list } = await import('./route');
const { GET: one } = await import('./[key]/route');
const req = {} as NextRequest;
const ctx = (key: string) => ({ params: Promise.resolve({ key }) });

beforeEach(() => {
  state.userId = 'u1';
  state.signedIn = true;
  state.dead = new Set();
  state.requestBuild.mockReset().mockReturnValue(false);
  state.lastResult.mockReset().mockReturnValue(null);
  delete process.env.MIXES_DISABLED;
});

describe('GET /api/mixes', () => {
  it('lists the member\'s own mixes as tiles, in order, without tracks', async () => {
    const body = await (await list(req, {})).json();
    expect(body).toMatchObject({ eligible: true, building: false });
    expect(body.mixes.map((m: { key: string }) => m.key)).toEqual(['rock-metal', 'pop']);
    expect(body.mixes[0]).toMatchObject({ title: 'Rock & Metal', subtitle: 'Gojira, Tool and more', count: 2, cover: { artworkUrls: ['x'], color: '#f2b8a8' } });
    expect(body.mixes[0]).not.toHaveProperty('tracks');
  });

  it('does not count dead songs', async () => {
    state.dead.add(tt('a1', 'Gojira').id);
    expect((await (await list(req, {})).json()).mixes[0].count).toBe(1);
  });

  it('asks the job for a build with what is stored, and says when one runs', async () => {
    state.userId = 'u3';
    state.requestBuild.mockReturnValue(true);
    const body = await (await list(req, {})).json();
    expect(state.requestBuild).toHaveBeenCalledWith('u3', []);
    expect(body).toEqual({ eligible: true, building: true, mixes: [] });
  });

  it('says not eligible once a build found too little listening', async () => {
    state.userId = 'u3';
    state.lastResult.mockReturnValue({ eligible: false });
    expect(await (await list(req, {})).json()).toEqual({ eligible: false, building: false, mixes: [] });
  });

  it('MIXES_DISABLED=1 never starts a build', async () => {
    process.env.MIXES_DISABLED = '1';
    await list(req, {});
    expect(state.requestBuild).not.toHaveBeenCalled();
  });

  it('401s when signed out', async () => {
    state.signedIn = false;
    expect((await list(req, {})).status).toBe(401);
  });
});

describe('GET /api/mixes/[key]', () => {
  it('gives the member\'s mix with its songs, dead ones dropped', async () => {
    state.dead.add(tt('a2', 'Tool').id);
    const body = await (await one(req, ctx('rock-metal'))).json();
    expect(body).toMatchObject({ key: 'rock-metal', title: 'Rock & Metal', builtAt: '2026-10-16T04:00:00.000Z' });
    expect(body.tracks.map((t: { artist: string }) => t.artist)).toEqual(['Gojira']);
  });

  it('another member\'s mix is a 404', async () => {
    expect((await one(req, ctx('balkan'))).status).toBe(404);
    state.userId = 'u2';
    expect((await one(req, ctx('balkan'))).status).toBe(200);
  });

  it('404s an unknown or malformed key', async () => {
    expect((await one(req, ctx('jazz-blues'))).status).toBe(404);
    expect((await one(req, ctx('"||1'))).status).toBe(404);
  });
});
