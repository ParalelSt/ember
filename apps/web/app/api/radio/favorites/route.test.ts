// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { stationTrack, type RadioStation } from '@/lib/radio/station';

/** Favourite stations: the member's own rows, details from Radio Browser
 *  (never the request), adding twice or removing a missing one is fine. */

const ID = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const station = (id = ID): RadioStation => {
  const base = { id, name: 'Otvoreni', favicon: 'https://logo.example/o.png', country: 'Croatia', countryCode: 'HR', state: '', codec: 'MP3', bitrate: 128, votes: 5, distanceKm: null };
  return { ...base, track: stationTrack(base) };
};

type Row = { id: string; user: string; station_id: string; name: string; url: string; favicon: string; added: string };
const rows: Row[] = [];
let n = 0;
/** Another request's create lands between this one's check and create. */
let raceOnce = false;

function matching(filter: string) {
  const user = /user = "(\w+)"/.exec(filter)?.[1];
  const sid = /station_id = "([\w-]+)"/.exec(filter)?.[1];
  return rows.filter((r) => r.user === user && (!sid || r.station_id === sid));
}

const col = {
  getList: vi.fn(async (_p: number, per: number, opts: { filter: string; sort?: string }) => {
    const all = matching(opts.filter).sort((a, b) => b.added.localeCompare(a.added));
    return { items: all.slice(0, per), totalItems: all.length };
  }),
  getFullList: vi.fn(async (opts: { filter: string }) => matching(opts.filter)),
  create: vi.fn(async (data: Omit<Row, 'id'>) => {
    if (raceOnce) {
      raceOnce = false;
      rows.push({ id: `r${++n}`, ...data });
    }
    if (rows.some((r) => r.user === data.user && r.station_id === data.station_id)) {
      throw Object.assign(new Error('Failed to create record.'), { status: 400 });
    }
    const row = { id: `r${++n}`, ...data };
    rows.push(row);
    return row;
  }),
  delete: vi.fn(async (id: string) => {
    rows.splice(rows.findIndex((r) => r.id === id), 1);
    return true;
  }),
};
const pb = { collection: vi.fn(() => col) };

let signedIn: string | null = 'u1';
vi.mock('@/lib/auth', () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
    requireUser: async () => {
      if (!signedIn) throw new UnauthorizedError();
      return { pb, user: { id: signedIn, email: '', isAdmin: false } };
    },
  };
});
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_n: string, h: unknown) => h }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
const svc = {
  station: vi.fn(async (id: string) => (id === ID || id === OTHER ? station(id) : null)),
  peek: vi.fn((): RadioStation | null => null),
  streamTarget: vi.fn(async () => ({ url: 'http://stream.example/live', codec: 'MP3' })),
};
vi.mock('@/lib/radio/service', () => ({ radioService: () => svc }));

const { _resetBuckets } = await import('@/lib/rateLimit');
const list = await import('./route');
const remove = await import('./[id]/route');
const { MAX_FAVORITES } = await import('@/lib/radio/favorites');

const post = (body: unknown) => new NextRequest('http://localhost/api/radio/favorites', { method: 'POST', body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

beforeEach(() => {
  rows.length = 0;
  raceOnce = false;
  signedIn = 'u1';
  _resetBuckets();
  vi.clearAllMocks();
});

describe('radio favourites', () => {
  it('are for members only', async () => {
    signedIn = null;
    expect((await list.GET(new NextRequest('http://localhost/api/radio/favorites'), {} as never)).status).toBe(401);
    expect((await list.POST(post({ id: ID }), {} as never)).status).toBe(401);
    expect((await remove.DELETE(new NextRequest('http://localhost/x'), ctx(ID))).status).toBe(401);
  });

  it('adds a station with what Radio Browser says about it, not what the request says', async () => {
    const res = await list.POST(post({ id: ID, name: 'Evil', url: 'http://10.0.0.1/', favicon: 'https://evil.example/x.png' }), {} as never);
    expect(res.status).toBe(201);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user: 'u1', station_id: ID, name: 'Otvoreni', url: 'http://stream.example/live', favicon: 'https://logo.example/o.png' });
  });

  it('lists only the member\'s own, newest first, as playable live items', async () => {
    await list.POST(post({ id: ID }), {} as never);
    await new Promise((r) => setTimeout(r, 5));
    await list.POST(post({ id: OTHER }), {} as never);
    signedIn = 'u2';
    await list.POST(post({ id: ID }), {} as never);
    signedIn = 'u1';
    const body = await (await list.GET(new NextRequest('http://localhost/api/radio/favorites'), {} as never)).json();
    expect(body.stations.map((s: RadioStation) => s.id)).toEqual([OTHER, ID]);
    expect(body.stations[0].track).toMatchObject({ source: 'station', streamUrl: `/api/radio/stream/${OTHER}`, durationSec: 0 });
  });

  it('adding twice, or two taps at once, keeps one row', async () => {
    expect((await list.POST(post({ id: ID }), {} as never)).status).toBe(201);
    expect((await list.POST(post({ id: ID }), {} as never)).status).toBe(200);
    rows.length = 0;
    raceOnce = true;
    expect((await list.POST(post({ id: ID }), {} as never)).status).toBe(200);
    expect(rows).toHaveLength(1);
  });

  it('refuses a malformed id, and a station Radio Browser does not know', async () => {
    expect((await list.POST(post({ id: 'x' }), {} as never)).status).toBe(400);
    expect((await list.POST(post({ id: '00000000-0000-4000-8000-000000000009' }), {} as never)).status).toBe(404);
    expect(rows).toHaveLength(0);
  });

  it(`keeps at most ${MAX_FAVORITES}`, async () => {
    for (let i = 0; i < MAX_FAVORITES; i++) {
      rows.push({ id: `x${i}`, user: 'u1', station_id: `s${i}`, name: '', url: '', favicon: '', added: '' });
    }
    expect((await list.POST(post({ id: ID }), {} as never)).status).toBe(400);
  });

  it('removes only the member\'s own, and removing one that is not there is fine', async () => {
    await list.POST(post({ id: ID }), {} as never);
    signedIn = 'u2';
    await list.POST(post({ id: ID }), {} as never);
    expect((await remove.DELETE(new NextRequest('http://localhost/x'), ctx(ID))).status).toBe(200);
    expect(rows.map((r) => r.user)).toEqual(['u1']);
    expect((await remove.DELETE(new NextRequest('http://localhost/x'), ctx(ID))).status).toBe(200);
    expect((await remove.DELETE(new NextRequest('http://localhost/x'), ctx('bad'))).status).toBe(400);
  });
});
