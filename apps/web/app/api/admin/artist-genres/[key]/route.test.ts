// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { manualOverride } from '@/lib/genres/override';
import type { ArtistGenre } from '@/lib/genres/tagger';

// The admin override against a stub store: who may call it, what a manual
// row looks like, and bad bodies.

const state = vi.hoisted(() => ({ admin: true, signedIn: true, rows: new Map<string, unknown>(), saved: [] as unknown[] }));

vi.mock('@/lib/auth', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthorizedError,
    ForbiddenError,
    requireAdmin: async () => {
      if (!state.signedIn) throw new UnauthorizedError();
      if (!state.admin) throw new ForbiddenError();
      return { pb: {}, user: { id: 'admin', email: '', isAdmin: true } };
    },
    unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
    forbiddenResponse: () => Response.json({ error: 'Forbidden' }, { status: 403 }),
  };
});
vi.mock('@/lib/pocketbase/server', () => ({ createAdminClient: async () => ({}) }));
vi.mock('@/lib/genres/store', () => ({
  pbGenreStore: () => ({
    getMany: async (keys: string[]) => new Map(keys.filter((k) => state.rows.has(k)).map((k) => [k, state.rows.get(k)])),
    save: async (row: { key: string }) => { state.saved.push(row); state.rows.set(row.key, row); },
  }),
}));
vi.mock('@/lib/upsertTrack', () => ({
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_r: string, h: unknown) => h }));

const { GET, PATCH } = await import('./route');
const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const ctx = (key: string) => ({ params: Promise.resolve({ key }) });

beforeEach(() => {
  state.admin = true;
  state.signedIn = true;
  state.rows.clear();
  state.saved.length = 0;
});

describe('PATCH /api/admin/artist-genres/[key]', () => {
  it('stores a manual family that wins over lookups', async () => {
    const res = await PATCH(req({ family: 'rock-metal', sub: 'metal' }), ctx(encodeURIComponent('Gojira - Topic')));
    expect(res.status).toBe(200);
    expect(state.saved[0]).toMatchObject({ key: 'gojira', family: 'rock-metal', sub: 'metal', source: 'manual', status: 'found', families: { 'rock-metal': 1 } });
  });

  it('null puts the artist in no family', async () => {
    await PATCH(req({ family: null }), ctx('someone'));
    expect(state.saved[0]).toMatchObject({ family: null, status: 'none', source: 'manual', families: {} });
  });

  it('refuses unknown families, wrong halves and empty bodies', async () => {
    expect((await PATCH(req({ family: 'polka' }), ctx('x'))).status).toBe(400);
    expect((await PATCH(req({ family: 'pop', sub: 'metal' }), ctx('x'))).status).toBe(400);
    expect((await PATCH(req(null), ctx('x'))).status).toBe(400);
    expect(state.saved).toHaveLength(0);
  });

  it('is for admins only', async () => {
    state.admin = false;
    expect((await PATCH(req({ family: 'pop' }), ctx('x'))).status).toBe(403);
    state.signedIn = false;
    expect((await PATCH(req({ family: 'pop' }), ctx('x'))).status).toBe(401);
    expect((await GET(req(null), ctx('x'))).status).toBe(401);
    expect(state.saved).toHaveLength(0);
  });
});

describe('GET /api/admin/artist-genres/[key]', () => {
  it('answers the stored row or null', async () => {
    expect(await (await GET(req(null), ctx('nobody'))).json()).toEqual({ artist: null });
    state.rows.set('ceca', { key: 'ceca', family: 'balkan' });
    expect(await (await GET(req(null), ctx('Ceca'))).json()).toEqual({ artist: { key: 'ceca', family: 'balkan' } });
  });
});

describe('manualOverride', () => {
  it('keeps the old name and tags when the body has no name', () => {
    const existing: ArtistGenre = { key: 'a', name: 'A Band', artistId: 'UC1', family: 'pop', families: {}, sub: null, tags: [{ name: 'pop', count: 1 }], source: 'lastfm', status: 'found', fetchedAt: '' };
    const row = manualOverride('a', { family: 'jazz-blues' }, existing, 0);
    expect(row).toMatchObject({ name: 'A Band', artistId: 'UC1', tags: [{ name: 'pop', count: 1 }], family: 'jazz-blues' });
    expect(manualOverride('', { family: 'pop' }, undefined, 0)).toBe('artist required');
  });
});
