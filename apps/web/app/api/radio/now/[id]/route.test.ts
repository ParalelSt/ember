// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/** GET /api/radio/now/[id]: members only, a station id and never an
 *  address, and the stream it reads is the one Radio Browser listed. */

const ID = '00000000-0000-4000-8000-000000000001';

let signedIn: string | null = 'u1';
vi.mock('@/lib/auth', () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
    requireUser: async () => {
      if (!signedIn) throw new UnauthorizedError();
      return { pb: {}, user: { id: signedIn, email: '', isAdmin: false } };
    },
  };
});
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_n: string, h: unknown) => h }));

const svc = vi.hoisted(() => ({
  streamTarget: vi.fn(async (id: string) => (id === '00000000-0000-4000-8000-000000000001' ? { url: 'http://stream.example/live', codec: 'MP3' } : null)),
}));
vi.mock('@/lib/radio/service', () => ({ radioService: () => svc }));
const np = vi.hoisted(() => ({ song: vi.fn(async () => ({ artist: 'Severina', title: 'Italiana' }) as { artist: string | null; title: string } | null) }));
vi.mock('@/lib/radio/nowPlaying', () => ({ stationNowPlaying: () => np }));

const { _resetBuckets } = await import('@/lib/rateLimit');
const { GET } = await import('./route');

const call = (id: string, query = '') =>
  GET(new NextRequest(`http://localhost/api/radio/now/${id}${query}`), { params: Promise.resolve({ id }) } as never);

beforeEach(() => {
  signedIn = 'u1';
  _resetBuckets();
  vi.clearAllMocks();
});

describe('GET /api/radio/now/[id]', () => {
  it('names the song from the address Radio Browser listed for the station', async () => {
    const res = await call(ID);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ song: { artist: 'Severina', title: 'Italiana' } });
    expect(np.song).toHaveBeenCalledWith(ID, 'http://stream.example/live');
    expect(res.headers.get('Cache-Control')).toContain('private');
  });

  it('ignores any address the client sends', async () => {
    await call(ID, '?url=http://127.0.0.1:8090/');
    expect(np.song).toHaveBeenCalledWith(ID, 'http://stream.example/live');
  });

  it('answers null when the station names no song', async () => {
    np.song.mockResolvedValueOnce(null);
    expect(await (await call(ID)).json()).toEqual({ song: null });
  });

  it('is for members only', async () => {
    signedIn = null;
    expect((await call(ID)).status).toBe(401);
    expect(np.song).not.toHaveBeenCalled();
  });

  it('answers 400 for a malformed id and 404 for an unknown station', async () => {
    expect((await call('..%2Fx')).status).toBe(400);
    expect((await call('00000000-0000-4000-8000-000000000009')).status).toBe(404);
    expect(np.song).not.toHaveBeenCalled();
  });
});
