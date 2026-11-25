import { describe, expect, it } from 'vitest';
import { anonSessions, buildPlatformRollup, ROLLUP_PLATFORMS, shellLabel } from './platformRollup';
import type { StoredDigest } from './sessions';
import type { PerfDigest } from './types';

/** The perf channel's per-platform rollup: the math, empty platforms, old
 *  batches without an os, and that nothing identifying gets out. */

const SINCE = Date.UTC(2026, 10, 23, 6);
const UNTIL = Date.UTC(2026, 10, 23, 12);
const T = (min: number) => SINCE + min * 60_000;

function stored(userId: string, over: Partial<PerfDigest> & { ts?: number } = {}): StoredDigest {
  const { ts = T(30), ...d } = over;
  return {
    ts,
    userId,
    digest: { v: 1, session: 's1', seq: 1, t0: SINCE, app: '0.7.51', shell: 'capacitor', os: 'android', device: {}, fgMs: 0, ...d },
  };
}

const p = (r: ReturnType<typeof buildPlatformRollup>, os: string) => r.platforms.find((x) => x.os === os)!;

describe('buildPlatformRollup', () => {
  it('always has every platform, in order, with empty ones zeroed', () => {
    const r = buildPlatformRollup([], SINCE, UNTIL);
    expect(r.platforms.map((x) => x.os)).toEqual([...ROLLUP_PLATFORMS, 'other']);
    expect(r.totals).toEqual({ sessions: 0, members: 0, batches: 0, byOs: { android: 0, ios: 0, windows: 0, macos: 0, linux: 0, other: 0 } });
    const ios = p(r, 'ios');
    expect(ios).toMatchObject({ sessions: 0, members: 0, fgHours: 0, longTaskMsPerMin: 0, domMax: 0, slowestRoutes: [], shells: {} });
    expect(ios.launch.hydrated).toEqual({ n: 0, p50: 0, p95: 0 });
    expect(ios.heap.growth).toEqual({ sessions: 0, p50: 0, p95: 0, max: 0 });
    expect(ios.sideNav).toEqual({ taps: 0, abandoned: 0, routes: [] });
    expect(ios.native).toEqual({ rendererGone: 0, rendererUnresponsive: 0, lowMemory: 0, trimMemory: 0 });
    expect(ios.heapSlopes).toEqual([]);
    expect(r.host).toMatchObject({ lines: 0, requests: 0, slowest: [], sideNav: [] });
  });

  it('keeps only the window: after since, up to and including until', () => {
    const r = buildPlatformRollup(
      [stored('u1', { ts: SINCE, session: 'a' }), stored('u1', { ts: SINCE + 1, session: 'b' }), stored('u1', { ts: UNTIL, session: 'c' }), stored('u1', { ts: UNTIL + 1, session: 'd' })],
      SINCE,
      UNTIL,
    );
    expect(r.totals.sessions).toBe(2);
  });

  it('counts sessions, distinct members, foreground hours and the shell split per platform', () => {
    const r = buildPlatformRollup(
      [
        stored('u1', { session: 'a', seq: 1, fgMs: 1_800_000 }),
        stored('u1', { session: 'a', seq: 2, fgMs: 1_800_000 }),
        stored('u1', { session: 'b', fgMs: 3_600_000, shell: 'web' }),
        stored('u2', { session: 'a', fgMs: 3_600_000 }),
        stored('u3', { session: 'w', os: 'windows', shell: 'tauri', fgMs: 600_000 }),
        stored('u3', { session: 'w2', os: 'windows', shell: 'web' }),
      ],
      SINCE,
      UNTIL,
    );
    const a = p(r, 'android');
    expect(a).toMatchObject({ sessions: 3, members: 2, fgHours: 3, shells: { 'phone app': 2, browser: 1 } });
    expect(p(r, 'windows')).toMatchObject({ sessions: 2, members: 1, shells: { 'desktop app': 1, browser: 1 } });
    expect(r.totals).toMatchObject({ sessions: 5, members: 3, batches: 6, byOs: { android: 3, windows: 2, ios: 0 } });
  });

  it('works out launch, navigation, long tasks per minute, freezes, taps and DOM', () => {
    const r = buildPlatformRollup(
      [
        stored('u1', {
          session: 'a',
          fgMs: 120_000,
          launch: { fcp: 1000, hydrated: 4000 },
          lt: { n: 3, ms: 600, max: 300 },
          nav: { n: 25, ms: [100, 200, 300, 400], worst: [{ to: '/settings', ms: 9000 }] },
          freeze: { n: 2, max: 5000 },
          rage: 1,
          slow: { n: 4, max: 700 },
          dom: 3000,
        }),
        stored('u2', { session: 'b', fgMs: 60_000, launch: { fcp: 3000, hydrated: 30_000 }, lt: { n: 1, ms: 300, max: 300 }, nav: { n: 1, ms: [500] }, freeze: { n: 1, max: 7000 }, dom: 5000 }),
      ],
      SINCE,
      UNTIL,
    );
    const a = p(r, 'android');
    expect(a.launch.fcp).toEqual({ n: 2, p50: 1000, p95: 3000 });
    expect(a.launch.hydrated).toEqual({ n: 2, p50: 4000, p95: 30_000 });
    expect(a.nav).toEqual({ n: 26, p50: 300, p95: 500, max: 9000, ready: { n: 0, p50: 0, p95: 0 } });
    // 900 ms of long tasks over 3 foreground minutes.
    expect(a.longTaskMsPerMin).toBe(300);
    expect(a.freezes).toEqual({ n: 3, max: 7000 });
    expect(a).toMatchObject({ rageTaps: 1, slowTaps: 4, domMax: 5000 });
  });

  it('takes heap readings, growth per session (last minus first) and the typical device', () => {
    const r = buildPlatformRollup(
      [
        // Stored out of order: growth follows the batch numbers.
        stored('u1', { session: 'a', seq: 2, ts: T(10), heap: { used: 90 }, device: { mem: 4, cores: 8 } }),
        stored('u1', { session: 'a', seq: 1, ts: T(20), heap: { used: 40 }, device: { mem: 4, cores: 8 } }),
        stored('u2', { session: 'b', seq: 1, heap: { used: 50 }, device: { mem: 8, cores: 8 } }),
        stored('u2', { session: 'b', seq: 2, heap: { used: 45 }, device: { mem: 8, cores: 8 } }),
        stored('u3', { session: 'c', heap: { used: 60 }, device: { mem: 2, cores: 4 } }),
      ],
      SINCE,
      UNTIL,
    );
    const a = p(r, 'android');
    expect(a.heap).toEqual({ readings: 5, p50: 50, max: 90, growth: { sessions: 2, p50: -5, p95: 50, max: 50 } });
    expect(a.device).toEqual({ memGb: 4, cores: 8 });
  });

  it('names the 3 slowest routes, from nav events or the worst navs of a batch without events', () => {
    const r = buildPlatformRollup(
      [
        stored('u1', {
          session: 'a',
          ev: [
            { k: 'nav', at: 1, to: '/settings', via: 'tap', ms: 900, lt: 0 },
            { k: 'nav', at: 2, to: '/settings', via: 'tap', ms: 1100, lt: 0 },
            { k: 'nav', at: 3, to: '/playlist/abc123def456ghi', via: 'push', ms: 4000, lt: 0 },
            { k: 'nav', at: 4, to: '/radio', via: 'tap', lt: 0, abandoned: true },
            { k: 'nav', at: 5, to: '/', via: 'pop', ms: 100, lt: 0 },
          ],
          // Ignored: the batch has events.
          nav: { n: 4, ms: [900, 1100, 4000, 100], worst: [{ to: '/playlist/:id', ms: 4000 }] },
        }),
        stored('u2', { session: 'b', nav: { n: 1, ms: [2000], worst: [{ to: '/library', ms: 2000 }] } }),
      ],
      SINCE,
      UNTIL,
    );
    expect(p(r, 'android').slowestRoutes).toEqual([
      { route: '/playlist/:id', n: 1, p50: 4000, p95: 4000, max: 4000 },
      { route: '/library', n: 1, p50: 2000, p95: 2000, max: 2000 },
      { route: '/settings', n: 2, p50: 900, p95: 1100, max: 1100 },
    ]);
  });

  it('breaks side nav taps down per destination: time, host wait vs page work, re-taps', () => {
    const tap = (to: string, ms: number | undefined, more: Record<string, unknown> = {}) =>
      ({ k: 'nav', at: 1, to, via: 'tap', lt: 0, area: 'drawer', ...(ms !== undefined ? { ms } : {}), ...more }) as const;
    const r = buildPlatformRollup(
      [
        stored('u1', {
          session: 'a',
          ev: [
            tap('/settings', 6000, { server: 5000, commit: 300 }),
            tap('/settings', 2000, { server: 1500, commit: 200 }),
            tap('/settings', 800),
            tap('/settings', undefined, { abandoned: true }),
            tap('/radio', 400, { server: 100, commit: 250, area: 'sidebar' }),
            // Not side nav: the bottom bar, no area, and code navigation.
            tap('/library', 9000, { area: 'bottom' }),
            { k: 'nav', at: 1, to: '/library', via: 'tap', ms: 9000, lt: 0 },
            { k: 'nav', at: 1, to: '/library', via: 'push', ms: 9000, lt: 0, area: 'drawer' },
          ],
        }),
      ],
      SINCE,
      UNTIL,
    );
    expect(p(r, 'android').sideNav).toEqual({
      taps: 4,
      abandoned: 1,
      routes: [
        { route: '/settings', n: 3, abandoned: 1, p50: 2000, p95: 6000, phased: 2, serverP50: 1500, commitP50: 200 },
        { route: '/radio', n: 1, abandoned: 0, p50: 400, p95: 400, phased: 1, serverP50: 100, commitP50: 250 },
      ],
    });
  });

  it('adds tap to content ready: per platform, per side nav route, per slow route, and the api that ended last', () => {
    const nav = (to: string, ms: number, ready: number | undefined, more: Record<string, unknown> = {}) =>
      ({ k: 'nav', at: 1, to, via: 'tap', lt: 0, area: 'sidebar', ms, ...(ready !== undefined ? { ready, wait: ready - ms } : {}), ...more }) as const;
    const r = buildPlatformRollup(
      [
        stored('u1', {
          session: 'a',
          ev: [
            nav('/library', 300, 2300, { api: '/api/playlists' }),
            nav('/library', 200, 1200, { api: '/api/playlists' }),
            nav('/library', 250, 4250, { api: '/api/youtube/recommended' }),
            nav('/library', 250, 3250, { api: '/api/playlists' }),
            nav('/settings', 100, 100),
            nav('/radio', 400, undefined),
          ],
        }),
        // A batch whose events were dropped still has its window list.
        stored('u1', { session: 'a', seq: 2, nav: { n: 2, ms: [300, 300], ready: [900, 1000] } }),
      ],
      SINCE,
      UNTIL,
    );
    const a = p(r, 'android');
    expect(a.nav.ready).toEqual({ n: 7, p50: 1200, p95: 4250 });
    const lib = a.sideNav.routes.find((x) => x.route === '/library')!;
    expect(lib.ready).toEqual({ n: 4, p50: 2300, p95: 4250 });
    expect(lib.waitP50).toBe(2000);
    expect(lib.waitApi).toBe('/api/playlists');
    const settings = a.sideNav.routes.find((x) => x.route === '/settings')!;
    expect(settings.ready).toEqual({ n: 1, p50: 100, p95: 100 });
    expect(settings.waitApi).toBeUndefined();
    expect(a.sideNav.routes.find((x) => x.route === '/radio')!.ready).toBeUndefined();
    expect(a.slowestRoutes.find((x) => x.route === '/library')!.ready).toEqual({ n: 4, p50: 2300, p95: 4250 });
    const row = anonSessions([stored('u1', { session: 'a', ev: [nav('/library', 300, 2300), nav('/library', 200, 1200)] })], SINCE, UNTIL, (k, id) => `${k}:${id.length}`)[0];
    expect(row.nav.readyP50).toBe(1200);
    expect(row.nav.readyP95).toBe(2300);
  });

  it('puts an old batch without os under the platform its shell or device says, else other', () => {
    const old = (userId: string, session: string, shell: string, device: PerfDigest['device'] = {}): StoredDigest => {
      const e = stored(userId, { session, shell, device });
      delete e.digest.os;
      return e;
    };
    const r = buildPlatformRollup([old('u1', 'a', 'capacitor'), old('u2', 'b', 'web', { model: 'Pixel 8' }), old('u3', 'c', 'tauri')], SINCE, UNTIL);
    expect(r.totals.byOs).toMatchObject({ android: 2, other: 1 });
  });

  it('never carries a member id, email, or an id in a route', () => {
    const r = buildPlatformRollup(
      [
        stored('userid12345abcd', {
          session: 'sess-secret-1',
          ev: [{ k: 'nav', at: 1, to: '/artist/somesecretartist', via: 'tap', ms: 900, lt: 0, area: 'drawer' }],
          nav: { n: 1, ms: [900], worst: [{ to: '/song/secretsongid', ms: 900 }] },
        }),
      ],
      SINCE,
      UNTIL,
      [
        { ts: T(5), kind: 'error', level: 'info', category: 'native', message: 'n', sessionId: 'sess-secret-1', side: 'server', reqId: '', route: '', userId: 'userid12345abcd', surface: 'phone', data: { event: 'renderer.gone' } },
      ],
    );
    expect(p(r, 'android').native.rendererGone).toBe(1);
    const text = JSON.stringify(r);
    for (const secret of ['userid12345abcd', 'sess-secret-1', 'somesecretartist', 'secretsongid']) expect(text).not.toContain(secret);
  });
});

describe('anonSessions', () => {
  it('one row per session with hashed ids only, newest first', () => {
    const anon = (kind: string, id: string) => `${kind[0]}-${id.length}`;
    const rows = anonSessions(
      [
        stored('userid12345abcd', { session: 'sess-secret-1', ts: T(10), seq: 1, heap: { used: 40 }, fgMs: 1000, launch: { fcp: 900, hydrated: 3000, ttfb: 100 }, device: { mem: 4, model: 'Pixel 8' } }),
        stored('userid12345abcd', { session: 'sess-secret-1', ts: T(20), seq: 3, heap: { used: 70 }, fgMs: 2000, dom: 1500 }),
        stored('otheruser9876', { session: 'sess-secret-2', ts: T(40), os: 'macos', shell: 'web' }),
      ],
      SINCE,
      UNTIL,
      anon,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ os: 'macos', shell: 'browser', last: T(40) });
    expect(rows[1]).toMatchObject({
      os: 'android',
      shell: 'phone app',
      batches: 2,
      missing: 1,
      fgMs: 3000,
      launch: { fcp: 900, hydrated: 3000 },
      heap: { first: 40, last: 70, max: 70 },
      domMax: 1500,
      device: { mem: 4, model: 'Pixel 8' },
    });
    const text = JSON.stringify(rows);
    for (const secret of ['userid12345abcd', 'otheruser9876', 'sess-secret-1', 'sess-secret-2']) expect(text).not.toContain(secret);
    expect(rows[1].member).toBe('m-15');
  });
});

describe('shellLabel', () => {
  it('names the shells as people say them', () => {
    expect(shellLabel('capacitor')).toBe('phone app');
    expect(shellLabel('tauri')).toBe('desktop app');
    expect(shellLabel('web')).toBe('browser');
    expect(shellLabel('x')).toBe('other');
  });
});
