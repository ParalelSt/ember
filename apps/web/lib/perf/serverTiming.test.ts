// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createServerTiming, makeHealth, registerServerTiming, requestRoute, SERVER_TIMING_LIMITS } from './serverTiming';
import { perfLogEnabled, perfSample } from './hostSwitch';

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
