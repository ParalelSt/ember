// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { NextRequest } from 'next/server';
import { stationTrack, type RadioStation } from '@/lib/radio/station';

/** The radio routes against a fake Radio Browser service and a fake station
 *  stream: members only, rounded coordinates, a budget, and a proxy that
 *  takes a station id (never an address) and lets go of its slot. */

const ID = '00000000-0000-4000-8000-000000000001';
const station = (id = ID): RadioStation => {
  const base = { id, name: 'Otvoreni', favicon: null, country: 'Croatia', countryCode: 'HR', state: '', codec: 'MP3', bitrate: 128, votes: 5, distanceKm: 3 };
  return { ...base, track: stationTrack(base) };
};

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
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const svc = {
  nearby: vi.fn<(lat: number, lng: number) => Promise<RadioStation[]>>(async () => [station()]),
  country: vi.fn<(code: string) => Promise<RadioStation[]>>(async () => [station()]),
  search: vi.fn<(q: string) => Promise<RadioStation[]>>(async () => [station()]),
  station: vi.fn(async (id: string) => (id === ID ? station() : null)),
  peek: vi.fn(() => null),
  streamTarget: vi.fn(async (id: string) => (id === ID ? { url: 'http://stream.example/live', codec: 'MP3' } : null)),
};
vi.mock('@/lib/radio/service', async (orig) => ({ ...(await orig<object>()), radioService: () => svc }));

const opened: { url: string; body: PassThrough; closed: boolean }[] = [];
let upstreamType = 'audio/mpeg';
let upstreamStatus = 200;
vi.mock('@/lib/radio/streamProxy', async (orig) => {
  const real = await orig<typeof import('@/lib/radio/streamProxy')>();
  const slots = real.createStreamSlots(2, 40);
  return {
    ...real,
    streamSlots: () => slots,
    openUpstream: vi.fn(async (url: string) => {
      const body = new PassThrough();
      const entry = { url, body, closed: false };
      opened.push(entry);
      return {
        status: upstreamStatus,
        headers: { 'content-type': upstreamType },
        body,
        close: () => { entry.closed = true; body.destroy(); },
      };
    }),
  };
});

const { _resetBuckets } = await import('@/lib/rateLimit');
const nearby = await import('./nearby/route');
const country = await import('./country/route');
const search = await import('./search/route');
const one = await import('./station/route');
const stream = await import('./stream/[id]/route');
const { streamSlots } = await import('@/lib/radio/streamProxy');

const req = (path: string) => new NextRequest(`http://localhost${path}`);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

beforeEach(() => {
  signedIn = 'u1';
  upstreamType = 'audio/mpeg';
  upstreamStatus = 200;
  opened.length = 0;
  _resetBuckets();
  vi.clearAllMocks();
});

describe('radio lists', () => {
  it('are for members only', async () => {
    signedIn = null;
    expect((await nearby.GET(req('/api/radio/nearby?lat=45.8&lng=16'), {} as never)).status).toBe(401);
    expect((await country.GET(req('/api/radio/country?code=HR'), {} as never)).status).toBe(401);
    expect((await search.GET(req('/api/radio/search?q=abc'), {} as never)).status).toBe(401);
    expect((await one.GET(req(`/api/radio/station?id=${ID}`), {} as never)).status).toBe(401);
    expect(svc.nearby).not.toHaveBeenCalled();
  });

  it('nearby rounds the point to a tenth of a degree before using it', async () => {
    const res = await nearby.GET(req('/api/radio/nearby?lat=45.81444&lng=15.97798'), {} as never);
    expect(res.status).toBe(200);
    expect((await res.json()).stations[0].name).toBe('Otvoreni');
    expect(svc.nearby).toHaveBeenCalledWith(45.8, 16);
  });

  it('nearby refuses a missing or impossible point', async () => {
    expect((await nearby.GET(req('/api/radio/nearby?lat=95&lng=16'), {} as never)).status).toBe(400);
    expect((await nearby.GET(req('/api/radio/nearby?lat=45'), {} as never)).status).toBe(400);
    expect(svc.nearby).not.toHaveBeenCalled();
  });

  it('country takes a two-letter code only', async () => {
    expect((await country.GET(req('/api/radio/country?code=HR'), {} as never)).status).toBe(200);
    expect(svc.country).toHaveBeenCalledWith('HR');
    expect((await country.GET(req('/api/radio/country?code=HRV'), {} as never)).status).toBe(400);
  });

  it('search answers a too-short query with nothing, without asking anyone', async () => {
    const res = await search.GET(req('/api/radio/search?q=a'), {} as never);
    expect((await res.json()).stations).toEqual([]);
    expect(svc.search).not.toHaveBeenCalled();
  });

  it('station answers 400 for a malformed id and 404 for an unknown one', async () => {
    expect((await one.GET(req('/api/radio/station?id=../x'), {} as never)).status).toBe(400);
    expect((await one.GET(req('/api/radio/station?id=00000000-0000-4000-8000-000000000009'), {} as never)).status).toBe(404);
    expect((await (await one.GET(req(`/api/radio/station?id=${ID}`), {} as never)).json()).station.id).toBe(ID);
  });

  it('a member browsing too fast is slowed down', async () => {
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await country.GET(req('/api/radio/country?code=HR'), {} as never)).status;
    expect(last).toBe(429);
  });

  it('answers 502 when Radio Browser cannot be reached', async () => {
    svc.country.mockRejectedValueOnce(Object.assign(new Error('Radio Browser could not be reached'), { status: 502 }));
    expect((await country.GET(req('/api/radio/country?code=HR'), {} as never)).status).toBe(502);
  });
});

describe('GET /api/radio/stream/[id]', () => {
  it('is for members only, and takes a station id, nothing else', async () => {
    signedIn = null;
    expect((await stream.GET(req(`/api/radio/stream/${ID}`), ctx(ID))).status).toBe(401);
    signedIn = 'u1';
    expect((await stream.GET(req('/api/radio/stream/x'), ctx('http://evil.example/'))).status).toBe(400);
    expect((await stream.GET(req('/api/radio/stream/x'), ctx('00000000-0000-4000-8000-000000000009'))).status).toBe(404);
    expect(opened).toHaveLength(0);
  });

  it('streams the address Radio Browser listed for the station, as audio, never cached', async () => {
    const res = await stream.GET(req(`/api/radio/stream/${ID}`), ctx(ID));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(opened[0].url).toBe('http://stream.example/live');
    opened[0].body.end(Buffer.from('mp3bytes'));
    expect(await res.text()).toBe('mp3bytes');
    expect(streamSlots().count('u1')).toBe(0);
  });

  it('does not pass on a web page where the stream should be', async () => {
    upstreamType = 'text/html';
    const res = await stream.GET(req(`/api/radio/stream/${ID}`), ctx(ID));
    expect(res.status).toBe(502);
    expect(opened[0].closed).toBe(true);
    expect(streamSlots().count('u1')).toBe(0);
  });

  it('answers 502 for a station that refuses', async () => {
    upstreamStatus = 404;
    expect((await stream.GET(req(`/api/radio/stream/${ID}`), ctx(ID))).status).toBe(502);
    expect(streamSlots().count('u1')).toBe(0);
  });

  it('frees the slot when the listener leaves', async () => {
    const res = await stream.GET(req(`/api/radio/stream/${ID}`), ctx(ID));
    expect(streamSlots().count('u1')).toBe(1);
    await res.body!.cancel();
    expect(streamSlots().count('u1')).toBe(0);
    expect(opened[0].closed).toBe(true);
  });

  it('a member\'s third stream ends their first', async () => {
    const a = await stream.GET(req(`/api/radio/stream/${ID}`), ctx(ID));
    await stream.GET(req(`/api/radio/stream/${ID}`), ctx(ID));
    await stream.GET(req(`/api/radio/stream/${ID}`), ctx(ID));
    expect(opened.map((o) => o.closed)).toEqual([true, false, false]);
    expect(streamSlots().count('u1')).toBe(2);
    await a.body!.cancel().catch(() => {});
    for (const o of opened) o.body.destroy();
  });
});
