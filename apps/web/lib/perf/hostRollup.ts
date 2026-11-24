import type { ServerLogEntry } from '@/lib/logger/types';
import { nativePerfKind, type NativePerfKind } from '@/lib/reports/perfDigest';
import type { PerfOs } from './os';

/** The host's side of the perf channel's rollup (lib/perf/platformRollup.ts):
 *  the server's own timing lines (lib/perf/serverTiming.ts, one every
 *  5 min) summed over the window, and the native apps' renderer and memory
 *  events counted per platform. What the daily digest's Performance section
 *  carried before the perf channel took it over. Counts and shaped routes
 *  only. Pure. */

export interface HostRouteStat {
  route: string;
  /** Requests in the window. */
  n: number;
  /** Request-weighted median of the 5 min windows' medians. */
  p50: number;
  /** The worst 5 min window's p95, and the slowest request. */
  p95: number;
  max: number;
  /** Request-weighted median of each phase (auth, db, outside hosts), ms;
   *  left out for routes the host did not split. */
  ph?: { auth: number; db: number; upstream: number };
}

export interface NativeCounts {
  rendererGone: number;
  rendererUnresponsive: number;
  lowMemory: number;
  trimMemory: number;
}

export interface HostRollup {
  /** Timing lines read (one per 5 min the host was up). */
  lines: number;
  requests: number;
  slowRequests: number;
  loopP99Max: number;
  /** Slowest routes by median, with at least 3 requests; held streams out. */
  slowest: HostRouteStat[];
  /** Every route's numbers, for the side nav cross-check. */
  routes: HostRouteStat[];
  /** Native events from the desktop app, whose OS the log does not say. */
  desktopNative: NativeCounts;
}

const HOST_SLOWEST = 5;
const HOST_ROUTES_CAP = 100;

export function emptyNative(): NativeCounts {
  return { rendererGone: 0, rendererUnresponsive: 0, lowMemory: 0, trimMemory: 0 };
}

export function nativeTotal(c: NativeCounts): number {
  return c.rendererGone + c.rendererUnresponsive + c.lowMemory + c.trimMemory;
}

interface TimingRoute {
  route?: unknown;
  n?: unknown;
  p50?: unknown;
  p95?: unknown;
  max?: unknown;
  held?: unknown;
  ph?: { auth?: unknown; db?: unknown; upstream?: unknown };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

function weightedMedian(pairs: [number, number][]): number {
  const total = pairs.reduce((n, [, w]) => n + w, 0);
  if (!total) return 0;
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  let seen = 0;
  for (const [v, w] of sorted) {
    seen += w;
    if (seen >= total / 2) return v;
  }
  return sorted[sorted.length - 1][0];
}

/** The window's server timing lines summed per route. */
export function buildHostRollup(entries: ServerLogEntry[]): HostRollup {
  interface Acc {
    n: number;
    p50s: [number, number][];
    p95: number;
    max: number;
    ph: Record<'auth' | 'db' | 'upstream', [number, number][]>;
  }
  const byRoute = new Map<string, Acc>();
  let lines = 0;
  let requests = 0;
  let slow = 0;
  let loop = 0;
  const desktopNative = emptyNative();
  for (const e of entries) {
    const kind = nativePerfKind(e);
    if (kind) {
      if (e.surface === 'desktop') desktopNative[kind]++;
      continue;
    }
    if (e.category !== 'perf' || e.message !== 'server timing') continue;
    lines++;
    const data = (e.data ?? {}) as { routes?: unknown; slow?: unknown; health?: { loopP99?: unknown }; requests?: unknown };
    slow += num(data.slow);
    loop = Math.max(loop, num(data.health?.loopP99));
    for (const r of Array.isArray(data.routes) ? (data.routes as TimingRoute[]) : []) {
      if (typeof r?.route !== 'string' || r.held) continue;
      const n = num(r.n);
      if (!n) continue;
      requests += n;
      const a: Acc = byRoute.get(r.route) ?? { n: 0, p50s: [], p95: 0, max: 0, ph: { auth: [], db: [], upstream: [] } };
      a.n += n;
      a.p50s.push([num(r.p50), n]);
      a.p95 = Math.max(a.p95, num(r.p95));
      a.max = Math.max(a.max, num(r.max));
      if (r.ph && typeof r.ph === 'object') {
        for (const k of ['auth', 'db', 'upstream'] as const) a.ph[k].push([num(r.ph[k]), n]);
      }
      byRoute.set(r.route, a);
    }
  }
  const routes = [...byRoute.entries()]
    .map(([route, a]): HostRouteStat => {
      const ph = { auth: weightedMedian(a.ph.auth), db: weightedMedian(a.ph.db), upstream: weightedMedian(a.ph.upstream) };
      return {
        route,
        n: a.n,
        p50: weightedMedian(a.p50s),
        p95: a.p95,
        max: a.max,
        ...(a.ph.auth.length && (ph.auth || ph.db || ph.upstream) ? { ph } : {}),
      };
    })
    .sort((a, b) => b.p50 - a.p50 || b.n - a.n || a.route.localeCompare(b.route));
  return {
    lines,
    requests,
    slowRequests: slow,
    loopP99Max: loop,
    slowest: routes.filter((r) => r.n >= 3).slice(0, HOST_SLOWEST),
    routes: routes.slice(0, HOST_ROUTES_CAP),
    desktopNative,
  };
}

/** The platform a native log line is from: the phone app and the car
 *  surfaces are Android (the only phone app so far); the desktop app does
 *  not say its OS (null: counted on the host side). */
export function nativeOs(e: ServerLogEntry): PerfOs | null {
  return e.surface === 'desktop' ? null : 'android';
}

/** Native perf events per platform. */
export function nativeByOs(entries: ServerLogEntry[]): Map<PerfOs, NativeCounts> {
  const out = new Map<PerfOs, NativeCounts>();
  for (const e of entries) {
    const kind: NativePerfKind | null = nativePerfKind(e);
    if (!kind) continue;
    const os = nativeOs(e);
    if (!os) continue;
    const c = out.get(os) ?? emptyNative();
    c[kind]++;
    out.set(os, c);
  }
  return out;
}

/** A route's median split as the list prints it: auth, db, the outside
 *  hosts (only when they took time) and what is left of the median. */
export function phaseParts(r: HostRouteStat): { name: string; ms: number }[] {
  if (!r.ph) return [];
  const parts = [
    { name: 'auth', ms: r.ph.auth },
    { name: 'db', ms: r.ph.db },
    ...(r.ph.upstream ? [{ name: 'upstream', ms: r.ph.upstream }] : []),
  ];
  return [...parts, { name: 'other', ms: Math.max(0, r.p50 - r.ph.auth - r.ph.db - r.ph.upstream) }];
}

/** The host's numbers for a page's router data request: what a side nav
 *  tap waits on. */
export function hostForPage(host: HostRollup, route: string): HostRouteStat | undefined {
  return host.routes.find((r) => r.route === `${route} (rsc)`);
}
