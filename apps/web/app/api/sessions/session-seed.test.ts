// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Starting a carlist seeded from a playlist the caller cannot open is
// refused, and must leave nothing behind: a session row created before the
// check stayed "live" for hours (the Carlist button showed it) with nobody
// able to use it, and every retry made another.

type Row = Record<string, unknown>;
const writes: string[] = [];
const access = vi.fn<(...args: unknown[]) => Promise<unknown>>();
let failSeedCreate = false;

const server = {
  collection: (name: string) => ({
    create: async (data: Row): Promise<Row> => {
      if (name === 'session_tracks' && failSeedCreate) throw Object.assign(new Error('pb down'), { status: 502 });
      writes.push(`create:${name}`);
      return { id: `${name}-1`, ...data };
    },
    delete: async (id: string) => {
      writes.push(`delete:${name}:${id}`);
      return true;
    },
  }),
};

vi.mock('@/lib/auth', () => ({
  requireUser: async () => ({ pb: {}, user: { id: 'u1' } }),
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/sessions', () => ({
  newSessionCode: () => 'ABC234',
  LIVE_WINDOW_MS: 1,
  sessionsClient: async () => server,
  addMember: async () => {
    writes.push('create:session_members');
  },
}));
vi.mock('@/lib/playlistAccess', () => ({ playlistAccess: (...a: unknown[]) => access(...a) }));
vi.mock('@/lib/upsertTrack', () => ({
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: (e as { status?: number })?.status ?? 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { POST } = (await import('./route')) as unknown as { POST: (r: NextRequest) => Promise<Response> };
const req = (body: unknown) =>
  new NextRequest('http://ember.test/api/sessions', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  writes.length = 0;
  access.mockReset();
  failSeedCreate = false;
});

describe('POST /api/sessions with a seed playlist', () => {
  it('a playlist that is not yours: 404 and no session is created', async () => {
    access.mockResolvedValue(null);
    const res = await POST(req({ name: 'Trip', seedPlaylistId: 'someoneelse1' }));
    expect(res.status).toBe(404);
    expect(writes).toEqual([]);
  });

  it('a seed id that is not a string: 400, not a crash, and nothing created', async () => {
    const res = await POST(req({ seedPlaylistId: { evil: true } }));
    expect(res.status).toBe(400);
    expect(writes).toEqual([]);
  });

  it('a seed that fails halfway removes the session again', async () => {
    access.mockResolvedValue({ db: { collection: () => ({ getFullList: async () => [{ track: 't1' }] }) } });
    failSeedCreate = true;
    const res = await POST(req({ seedPlaylistId: 'mine1' }));
    expect(res.status).toBe(502);
    expect(writes).toContain('delete:sessions:sessions-1');
  });

  it('a playlist you can open seeds the queue', async () => {
    access.mockResolvedValue({ db: { collection: () => ({ getFullList: async () => [{ track: 't1' }, { track: 't2' }] }) } });
    const res = await POST(req({ seedPlaylistId: 'mine1' }));
    expect(res.status).toBe(201);
    expect(writes.filter((w) => w === 'create:session_tracks')).toHaveLength(2);
  });
});
