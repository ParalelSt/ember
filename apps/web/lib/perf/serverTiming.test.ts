// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createServerTiming, makeHealth, registerServerTiming, requestRoute, SERVER_TIMING_LIMITS } from './serverTiming';
import { perfLogEnabled, perfSample } from './hostSwitch';
import { addPhase, newPhases } from './phases';

/** Server request timing and host health (slice 3): per route stats with
 *  ids taken out, a capped number of slow lines, held streams never slow,
 *  bounded routes, and no header or cookie values anywhere. */

function sink() {
  return { info: vi.fn(), warn: vi.fn() };
}

function res(status: number, headers: Record<string, string> = {}) {
  return { statusCode: status, getHeader: (n: string) => headers[n] };
}

function timed() {
  let clock = 0;
  const s = sink();
  const t = createServerTiming({ sink: s, now: () => clock, health: () => ({ load: [0.5, 0.4, 0.3], rssMb: 300, heapMb: 120 }) });
  const run = (url: string, ms: number, status = 200, extra: { method?: string; headers?: Record<string, string>; resHeaders?: Record<string, string> } = {}) => {
    const req = { url, method: extra.method ?? 'GET', headers: extra.headers ?? {} };
    t.start(req);
    clock += ms;
    t.finish(req, res(status, extra.resHeaders));
  };
  return { t, s, run };
}

describe('requestRoute', () => {
  it('takes ids out and marks RSC requests', () => {
    expect(requestRoute({ url: '/playlist/abc123def456ghi?_rsc=1x' })).toBe('/playlist/:id (rsc)');
    expect(requestRoute({ url: '/settings', headers: { rsc: '1' } })).toBe('/settings (rsc)');
    expect(requestRoute({ url: '/api/likes?page=2' })).toBe('/api/likes');
  });
});

describe('createServerTiming', () => {
  it('keeps count, median, p95, max and status classes per route', () => {
    const { t, run } = timed();
    for (const ms of [20, 30, 40, 50, 900]) run('/api/likes', ms);
    run('/api/likes', 10, 500);
    run('/settings?_rsc=a', 300);
    const snap = t.snapshot();
    expect(snap.requests).toBe(7);
    const likes = snap.routes.find((r) => r.route === '/api/likes')!;
    expect(likes).toMatchObject({ n: 6, p50: 40, max: 900, s: { '2xx': 5, '5xx': 1 } });
    expect(likes.p95).toBe(900);
    expect(snap.routes.find((r) => r.route === '/settings (rsc)')).toMatchObject({ n: 1, max: 300 });
    expect(snap.health).toEqual({ load: [0.5, 0.4, 0.3], rssMb: 300, heapMb: 120 });
    // A fresh window after each snapshot.
    expect(t.snapshot().requests).toBe(0);
  });

  it('writes one warn line per request over 2 s, with its request id, number in data not message', () => {
    const { s, run } = timed();
    run('/settings?_rsc=x', 2500, 200, { resHeaders: { 'x-request-id': 'r1a2' } });
    expect(s.warn).toHaveBeenCalledTimes(1);
    const [cat, msg, data, , ctx] = s.warn.mock.calls[0];
    expect(cat).toBe('perf');
    expect(msg).toBe('slow request GET /settings (rsc)');
    expect(data).toEqual({ durationMs: 2500, status: 200, digest: false });
    expect(ctx).toEqual({ reqId: 'r1a2', route: '/settings (rsc)' });
  });

  it('caps slow lines per window and counts the rest', () => {
    const { t, s, run } = timed();
    for (let i = 0; i < 30; i++) run('/x', 3000);
    expect(s.warn).toHaveBeenCalledTimes(SERVER_TIMING_LIMITS.slowLinesPerWindow);
    expect(t.snapshot().slow).toBe(30);
  });

  it('never calls an audio stream, the held long poll or a download slow', () => {
    const { t, s, run } = timed();
    run('/api/youtube/stream/dQw4w9WgXcQ', 120_000);
    run('/api/remote/beat', 25_000);
    run('/api/uploads/abc/file', 9000, 200, { resHeaders: { 'content-type': 'audio/mpeg' } });
    expect(s.warn).not.toHaveBeenCalled();
    const snap = t.snapshot();
    // Held routes are listed after the rest.
    expect(snap.routes.every((r) => r.held)).toBe(true);
  });

  it('keeps at most 60 routes, the rest under "other"', () => {
    const { t, run } = timed();
    for (let i = 0; i < 100; i++) run(`/api/r${String.fromCharCode(97 + (i % 26))}${'q'.repeat(Math.floor(i / 26))}`, 5);
    const snap = t.snapshot();
    expect(snap.routes.length).toBeLessThanOrEqual(SERVER_TIMING_LIMITS.routesPerLine);
    expect(snap.requests).toBe(100);
  });

  it('never reads a cookie or authorization header into what it logs', () => {
    const { t, s, run } = timed();
    run('/library?token=secret', 2500, 200, { headers: { cookie: 'pb_auth=secret', authorization: 'Bearer secret' } });
    t.flush();
    const logged = JSON.stringify([s.warn.mock.calls, s.info.mock.calls]);
    expect(logged).not.toContain('secret');
    expect(s.info).toHaveBeenCalledWith('perf', 'server timing', expect.objectContaining({ requests: 1 }));
  });

  it('ignores a finish it never saw start', () => {
    const { t, s } = timed();
    t.finish({ url: '/x' }, res(200));
    expect(t.snapshot().requests).toBe(0);
    expect(s.warn).not.toHaveBeenCalled();
  });
});

describe('makeHealth', () => {
  it('reads the loop delay, load, memory and the download and Python lanes', () => {
    const g = globalThis as Record<symbol, unknown>;
    const gateKey = Symbol.for('ember.downloadGate');
    const lanesKey = Symbol.for('ember.pythonLanes');
    const hadGate = gateKey in g;
    const hadLanes = lanesKey in g;
    const oldGate = g[gateKey];
    const oldLanes = g[lanesKey];
    g[gateKey] = { inFlightCount: () => 2, waitingCount: () => 1 };
    g[lanesKey] = { interactive: { active: 3, waiting: 0 }, bulk: { active: 1, waiting: 4 } };
    try {
      const reset = vi.fn();
      const loop = { percentile: (p: number) => (p === 50 ? 5e6 : 80e6), max: 250e6, reset };
      const h = makeHealth(loop, { loadavg: () => [1.234, 1, 0.5] })();
      expect(h).toMatchObject({ loopP50: 5, loopP99: 80, loopMax: 250, load: [1.23, 1, 0.5], downloads: 2, downloadsWaiting: 1, python: 4, pythonWaiting: 4 });
      expect(h.rssMb).toBeGreaterThan(0);
      expect(reset).toHaveBeenCalled();
    } finally {
      if (hadGate) g[gateKey] = oldGate;
      else delete g[gateKey];
      if (hadLanes) g[lanesKey] = oldLanes;
      else delete g[lanesKey];
    }
  });
});

describe('createServerTiming: phases', () => {
  it('keeps each route\'s median auth, db and upstream beside its total', () => {
    let clock = 0;
    const t = createServerTiming({ sink: sink(), now: () => clock });
    const run = (url: string, total: number, ph: { auth?: number; db?: number; upstream?: number }, held = false) => {
      const req = { url, method: 'GET' };
      const phases = newPhases(() => clock);
      addPhase(phases, 'auth', ph.auth ?? 0);
      addPhase(phases, 'db', ph.db ?? 0);
      addPhase(phases, 'upstream', ph.upstream ?? 0);
      t.start(req, phases);
      clock += total;
      t.finish(req, res(200, held ? { 'content-type': 'audio/mpeg' } : {}));
    };
    for (let i = 0; i < 5; i++) run('/api/playlists', 600, { auth: 120, db: 430 });
    run('/api/youtube/recommended', 1900, { upstream: 1500 });
    run('/api/version', 5, {});
    run('/api/youtube/stream/abc', 9000, { db: 40 }, true);
    const { routes } = t.snapshot();
    const pl = routes.find((r) => r.route === '/api/playlists')!;
    expect(pl.p50).toBeGreaterThanOrEqual(600);
    // Medians come out of 1.2-step histogram buckets: within one bucket.
    expect(pl.ph!.auth).toBeGreaterThanOrEqual(120);
    expect(pl.ph!.auth).toBeLessThan(150);
    expect(pl.ph!.db).toBeGreaterThanOrEqual(430);
    expect(pl.ph!.db).toBeLessThan(520);
    expect(pl.ph!.upstream).toBe(0);
    expect(routes.find((r) => r.route === '/api/youtube/recommended')!.ph!.upstream).toBeGreaterThanOrEqual(1500);
    // Nothing spent in a phase: no split. Held streams are not split.
    expect(routes.find((r) => r.route === '/api/version')!.ph).toBeUndefined();
    expect(routes.find((r) => r.route === '/api/youtube/stream/:id')!.ph).toBeUndefined();
  });

  it('works for a request with no phases, as before', () => {
    const { t, run } = timed();
    run('/api/likes', 30);
    expect(t.snapshot().routes[0].ph).toBeUndefined();
  });
});

describe('registerServerTiming', () => {
  it('times a real request through diagnostics_channel and stops cleanly', async () => {
    const http = await import('node:http');
    const s = sink();
    const { timing, stop } = await registerServerTiming(s);
    const server = http.createServer((_req, res) => res.end('ok'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as { port: number };
    try {
      await fetch(`http://127.0.0.1:${port}/settings?_rsc=1`);
      await new Promise((r) => setTimeout(r, 20));
      timing.flush();
    } finally {
      stop();
      await new Promise((r) => server.close(r));
    }
    expect(s.warn).not.toHaveBeenCalled();
    const [, , snap] = s.info.mock.calls[0];
    expect(snap.requests).toBe(1);
    expect(snap.routes[0]).toMatchObject({ route: '/settings (rsc)', n: 1, s: { '2xx': 1 } });
    expect(typeof snap.health.loopP99).toBe('number');
    // Stopped: a later request is not timed.
    expect(timing.snapshot().requests).toBe(0);
  });
});

describe('registerServerTiming: phases through a real request', () => {
  it('splits a request into auth, db and the rest, sends them as Server-Timing and logs them per route', async () => {
    const http = await import('node:http');
    const pb = http.createServer((req, res) => {
      // PocketBase: sign-in check takes 30 ms, a records read 60 ms.
      setTimeout(() => res.end('{}'), req.url?.includes('auth-refresh') ? 30 : 60);
    });
    await new Promise<void>((r) => pb.listen(0, '127.0.0.1', r));
    const pbPort = (pb.address() as { port: number }).port;
    const oldEnv = process.env.POCKETBASE_URL;
    process.env.POCKETBASE_URL = `http://127.0.0.1:${pbPort}`;
    const s = sink();
    const { timing, stop } = await registerServerTiming(s);
    const app = http.createServer(async (_req, res) => {
      await fetch(`http://127.0.0.1:${pbPort}/api/collections/users/auth-refresh`, { method: 'POST' });
      // Two reads at once count as one stretch of db time.
      await Promise.all([fetch(`http://127.0.0.1:${pbPort}/api/collections/playlists/records`), fetch(`http://127.0.0.1:${pbPort}/api/collections/likes/records`)]);
      await new Promise((r) => setTimeout(r, 40));
      res.end('ok');
    });
    await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
    const appPort = (app.address() as { port: number }).port;
    let header = '';
    try {
      const answer = await fetch(`http://127.0.0.1:${appPort}/api/playlists`);
      header = answer.headers.get('server-timing') ?? '';
      await answer.text();
      await new Promise((r) => setTimeout(r, 20));
      timing.flush();
    } finally {
      stop();
      await new Promise((r) => app.close(r));
      await new Promise((r) => pb.close(r));
      if (oldEnv === undefined) delete process.env.POCKETBASE_URL;
      else process.env.POCKETBASE_URL = oldEnv;
    }
    const entry = (name: string) => Number(new RegExp(`${name};dur=(\\d+)`).exec(header)?.[1]);
    expect(entry('auth')).toBeGreaterThanOrEqual(25);
    expect(entry('auth')).toBeLessThan(80);
    expect(entry('db')).toBeGreaterThanOrEqual(55);
    // One stretch, not 60 + 60.
    expect(entry('db')).toBeLessThan(110);
    expect(entry('upstream')).toBe(0);
    expect(entry('total')).toBeGreaterThanOrEqual(entry('auth') + entry('db') + 35);
    const [, , snap] = s.info.mock.calls[0];
    const route = snap.routes.find((r: { route: string }) => r.route === '/api/playlists');
    expect(route.ph.db).toBeGreaterThanOrEqual(55);
    expect(route.ph.auth).toBeGreaterThanOrEqual(25);
    // Stopped: the real fetch is back.
    expect((globalThis as Record<symbol, unknown>)[Symbol.for('ember.perfPhaseFetch')]).toBeUndefined();
  });
});

describe('host switch', () => {
  it('EMBER_PERF_LOG=off (or 0/false) switches it off; anything else keeps it on', () => {
    expect(perfLogEnabled({})).toBe(true);
    expect(perfLogEnabled({ EMBER_PERF_LOG: 'off' })).toBe(false);
    expect(perfLogEnabled({ EMBER_PERF_LOG: ' OFF ' })).toBe(false);
    expect(perfLogEnabled({ EMBER_PERF_LOG: '0' })).toBe(false);
    expect(perfLogEnabled({ EMBER_PERF_LOG: 'on' })).toBe(true);
  });

  it('EMBER_PERF_SAMPLE is clamped to 0..1 and defaults to 1', () => {
    expect(perfSample({})).toBe(1);
    expect(perfSample({ EMBER_PERF_SAMPLE: '0.25' })).toBe(0.25);
    expect(perfSample({ EMBER_PERF_SAMPLE: '7' })).toBe(1);
    expect(perfSample({ EMBER_PERF_SAMPLE: '-1' })).toBe(0);
    expect(perfSample({ EMBER_PERF_SAMPLE: 'junk' })).toBe(1);
  });
});
