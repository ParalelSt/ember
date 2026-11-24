// @vitest-environment node
import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, expect, it, vi } from 'vitest';
import {
  addPhase,
  attachServerTiming,
  authFromHeader,
  classifyFetch,
  installPhaseStore,
  newPhases,
  phaseSnapshot,
  phaseStart,
  pocketbaseOrigin,
  serverTimingEntries,
  timedFetch,
  timePhase,
  withoutOwnEntries,
  type Phases,
} from './phases';

/** Where a request's time went: auth, db, upstream, other. The sums, the
 *  fetch classes, the header and the request's async context. */

const PB = 'http://127.0.0.1:8090';

function clocked() {
  let t = 0;
  const p = newPhases(() => t);
  return { p, at: (ms: number) => (t = ms) };
}

describe('phase sums', () => {
  it('adds each span, and other is what the three leave of the total', () => {
    const { p, at } = clocked();
    at(10);
    const a = phaseStart(p, 'auth');
    at(130);
    a();
    const d = phaseStart(p, 'db');
    at(560);
    d();
    addPhase(p, 'upstream', 40);
    expect(phaseSnapshot(p, 700)).toEqual({ auth: 120, db: 430, upstream: 40, other: 110, total: 700 });
  });

  it('counts overlapping calls once, as the time at least one was open', () => {
    const { p, at } = clocked();
    const a = phaseStart(p, 'db');
    at(100);
    const b = phaseStart(p, 'db');
    at(300);
    a();
    at(500);
    b();
    // Open from 0 to 500, not 300 + 400.
    expect(phaseSnapshot(p, 500).db).toBe(500);
    expect(phaseSnapshot(p, 500).other).toBe(0);
  });

  it('ends a span once, includes one still open, and never goes below zero for other', () => {
    const { p, at } = clocked();
    const e = phaseStart(p, 'db');
    at(50);
    e();
    e();
    expect(phaseSnapshot(p, 80).db).toBe(50);
    phaseStart(p, 'upstream');
    at(120);
    expect(phaseSnapshot(p, 100)).toMatchObject({ upstream: 70, other: 0 });
    addPhase(p, 'auth', -5);
    addPhase(p, 'auth', Number.NaN);
    expect(phaseSnapshot(p, 100).auth).toBe(0);
  });
});

describe('classifyFetch', () => {
  it('PocketBase is db, its sign-in and refresh are auth, other hosts are upstream', () => {
    expect(classifyFetch(`${PB}/api/collections/playlists/records?filter=x`, PB)).toBe('db');
    expect(classifyFetch(`${PB}/api/collections/users/auth-refresh`, PB)).toBe('auth');
    expect(classifyFetch(`${PB}/api/collections/_superusers/auth-with-password`, PB)).toBe('auth');
    expect(classifyFetch(`${PB}/api/admins/auth-refresh`, PB)).toBe('auth');
    expect(classifyFetch('https://music.youtube.com/youtubei/v1/browse', PB)).toBe('upstream');
    expect(classifyFetch('https://discord.com/api/webhooks/x', PB)).toBe('upstream');
  });

  it('leaves the app itself, non-http and junk out', () => {
    expect(classifyFetch('http://127.0.0.1:3000/api/x', PB)).toBeNull();
    expect(classifyFetch('http://localhost:3000/api/x', PB)).toBeNull();
    expect(classifyFetch('data:text/plain,hi', PB)).toBeNull();
    expect(classifyFetch('/relative', PB)).toBeNull();
  });

  it('reads the PocketBase origin like the server clients do', () => {
    expect(pocketbaseOrigin({})).toBe(PB);
    expect(pocketbaseOrigin({ POCKETBASE_URL: 'http://127.0.0.1:8088/' })).toBe('http://127.0.0.1:8088');
    expect(pocketbaseOrigin({ NEXT_PUBLIC_POCKETBASE_URL: '/pb' })).toBe(PB);
  });
});

describe('timedFetch', () => {
  it('sums PocketBase time as db, sign-in as auth and outside time as upstream for the running request', async () => {
    const { p, at } = clocked();
    let t = 0;
    const takes: Record<string, number> = {
      [`${PB}/api/collections/a/records`]: 200,
      [`${PB}/api/collections/b/records`]: 100,
      [`${PB}/api/collections/users/auth-refresh`]: 120,
      'https://yt.example/x': 60,
      'http://127.0.0.1:3000/api/self': 500,
    };
    // Each call takes its time on the fake clock between start and answer.
    const orig = vi.fn((input: RequestInfo | URL) => {
      t += takes[String(input)];
      at(t);
      return Promise.resolve(new Response('ok'));
    });
    const f = timedFetch(orig as unknown as typeof fetch, PB, () => p);
    for (const url of Object.keys(takes)) await f(url);
    expect(orig).toHaveBeenCalledTimes(5);
    expect(phaseSnapshot(p, 1000)).toEqual({ auth: 120, db: 300, upstream: 60, other: 520, total: 1000 });
  });

  it('returns the original promise untouched and counts a failure as finished', async () => {
    const { p, at } = clocked();
    const boom = new Error('refused');
    const f = timedFetch((() => new Promise((_, rej) => setTimeout(() => rej(boom), 1))) as unknown as typeof fetch, PB, () => p);
    await expect(f(`${PB}/api/collections/a/records`)).rejects.toBe(boom);
    at(30);
    // Closed: the span stopped at the failure, not still running.
    expect(phaseSnapshot(p, 30).db).toBeLessThan(30);
  });

  it('does nothing outside a request', async () => {
    const orig = vi.fn(() => Promise.resolve(new Response('ok')));
    const f = timedFetch(orig as unknown as typeof fetch, PB, () => undefined);
    expect(await (await f(`${PB}/x`)).text()).toBe('ok');
  });

  it('finds the request through its async context', async () => {
    const als = new AsyncLocalStorage<Phases>();
    installPhaseStore(als);
    const { p, at } = clocked();
    let release!: () => void;
    const orig = (() => new Promise<Response>((r) => (release = () => r(new Response('ok'))))) as unknown as typeof fetch;
    const f = timedFetch(orig, PB);
    await als.run(p, async () => {
      const open = f(`${PB}/api/collections/a/records`);
      at(75);
      release();
      await open;
    });
    expect(phaseSnapshot(p, 100).db).toBe(75);
    // Another context sees nothing.
    expect(await als.run(newPhases(() => 0), async () => phaseSnapshot((await Promise.resolve(als.getStore()))!, 10).db)).toBe(0);
    await als.run(p, () => timePhase('upstream', async () => at(95)));
    expect(phaseSnapshot(p, 100).upstream).toBe(20);
  });
});

describe('Server-Timing header', () => {
  it('lists the four entries, replacing the proxy\'s lone auth', () => {
    expect(serverTimingEntries({ auth: 120, db: 430, upstream: 0, other: 50, total: 600 })).toBe('auth;dur=120, db;dur=430, upstream;dur=0, total;dur=600');
    expect(withoutOwnEntries('auth;dur=5.1, cache;desc="hit", total;dur=9')).toBe('cache;desc="hit"');
    expect(authFromHeader('cache, auth;dur=12.5')).toBe(12.5);
    expect(authFromHeader('db;dur=3')).toBe(0);
  });

  function fakeRes(initial?: string) {
    const headers: Record<string, string> = initial ? { 'server-timing': initial } : {};
    const written: unknown[][] = [];
    const res = {
      headersSent: false,
      getHeader: (n: string) => headers[n],
      setHeader: (n: string, v: string) => void (headers[n] = v),
      writeHead: (...a: unknown[]) => void written.push(a),
    };
    return { res, headers, written };
  }

  it('sets it when the head is written, and still writes the head', () => {
    const { p, at } = clocked();
    const { res, headers, written } = fakeRes();
    attachServerTiming(res, p, 0);
    const d = phaseStart(p, 'db');
    at(430);
    d();
    at(500);
    res.writeHead(200, { a: 1 });
    expect(headers['server-timing']).toBe('auth;dur=0, db;dur=430, upstream;dur=0, total;dur=500');
    expect(written).toEqual([[200, { a: 1 }]]);
  });

  it('takes the proxy\'s auth entry when its own fetch could not be counted', () => {
    const { p, at } = clocked();
    const { res, headers } = fakeRes('auth;dur=120.4');
    attachServerTiming(res, p, 0);
    at(700);
    res.writeHead(200);
    expect(headers['server-timing']).toBe('auth;dur=120, db;dur=0, upstream;dur=0, total;dur=700');
    // And the same number is what the request's stats see.
    expect(phaseSnapshot(p, 700).auth).toBe(120);
  });

  it('does not double the auth time when fetch already counted it', () => {
    const { p, at } = clocked();
    const { res, headers } = fakeRes('auth;dur=999');
    attachServerTiming(res, p, 0);
    addPhase(p, 'auth', 80);
    at(200);
    res.writeHead(200);
    expect(headers['server-timing']).toContain('auth;dur=80,');
  });

  it('never breaks a response whose head is already sent', () => {
    const { p } = clocked();
    const { res, headers, written } = fakeRes();
    res.headersSent = true;
    attachServerTiming(res, p, 0);
    res.writeHead(200);
    expect(headers['server-timing']).toBeUndefined();
    expect(written).toHaveLength(1);
  });
});
