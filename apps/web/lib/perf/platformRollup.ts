import type { ServerLogEntry } from '@/lib/logger/types';
import { heapSlopes } from '@/lib/reports/perfDigest';
import { quantileOf } from './histogram';
import { buildHostRollup, emptyNative, hostForPage, nativeByOs, type HostRollup, type HostRouteStat, type NativeCounts } from './hostRollup';
import { digestOs, type PerfOs } from './os';
import { routeShape } from './route';
import { missingBatches, type StoredDigest } from './sessions';
import type { DeviceFacts, SessionEvent } from './types';

/** The perf channel's rollup (lib/reports/perfRollupJob.ts): every
 *  member's perf batches in a window, summed up per platform. Counts and
 *  timings only: no member id, email, song or artist leaves here (routes
 *  are shaped again, so an id in a stored route cannot get through).
 *  Per-session rows for the attached file carry ids only through the
 *  caller's `anon` (a salted hash). Pure: no files, no clock. */

/** The platforms the channel always shows, in order. 'other' is counted in
 *  the totals and the file, not given an embed of its own. */
export const ROLLUP_PLATFORMS = ['android', 'ios', 'windows', 'macos', 'linux'] as const satisfies readonly PerfOs[];

export const PLATFORM_LABEL: Record<PerfOs, string> = {
  android: 'Android',
  ios: 'iOS',
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  other: 'Other',
};

/** The shell a batch names, as people say it. */
export function shellLabel(shell: string): string {
  if (shell === 'capacitor') return 'phone app';
  if (shell === 'tauri') return 'desktop app';
  if (shell === 'web') return 'browser';
  return 'other';
}

/** The navs whose taps the owner watches most (side nav on a computer, the
 *  drawer on a phone). */
const SIDE_NAV_AREAS = new Set(['sidebar', 'drawer']);
const TOP_ROUTES = 3;
const SIDE_NAV_ROUTES = 12;

export interface Quantiles {
  n: number;
  p50: number;
  p95: number;
}

export interface RouteStat {
  route: string;
  n: number;
  p50: number;
  p95: number;
  max: number;
}

export interface SideNavRoute {
  route: string;
  /** Taps that reached the page, and those re-tapped (another link) before it loaded. */
  n: number;
  abandoned: number;
  p50: number;
  p95: number;
  /** Where the time went, over the taps that had an RSC request to time:
   *  host wait (request sent to first byte) and page work after the
   *  response (response end to the route change). */
  phased: number;
  serverP50: number;
  commitP50: number;
}

export interface PlatformStats {
  os: PerfOs;
  sessions: number;
  /** Distinct members, a count only. */
  members: number;
  /** Sessions per shell: phone app, desktop app, browser. */
  shells: Record<string, number>;
  fgHours: number;
  launch: { fcp: Quantiles; hydrated: Quantiles };
  nav: { n: number; p50: number; p95: number; max: number };
  /** Long task ms per minute in the foreground. */
  longTaskMsPerMin: number;
  freezes: { n: number; max: number };
  rageTaps: number;
  slowTaps: number;
  /** Heap MB over every reading, and its growth per session (last reading
   *  minus first, over sessions with two or more), the leak signal. */
  heap: { readings: number; p50: number; max: number; growth: { sessions: number; p50: number; p95: number; max: number } };
  domMax: number;
  /** The median session's device. */
  device: { memGb?: number; cores?: number };
  slowestRoutes: RouteStat[];
  sideNav: { taps: number; abandoned: number; routes: SideNavRoute[] };
  /** The native app's renderer deaths and memory warnings. */
  native: NativeCounts;
  /** Heap growth per hour per device model, fastest first (sessions with
   *  readings 10 min or more apart). */
  heapSlopes: { model: string; mbPerHour: number; sessions: number }[];
}

export interface PlatformRollup {
  since: number;
  until: number;
  totals: { sessions: number; members: number; batches: number; byOs: Record<PerfOs, number> };
  /** Always the five of ROLLUP_PLATFORMS, then 'other'. */
  platforms: PlatformStats[];
  /** The host's own timing, and the host's numbers for every side nav
   *  destination's router data request (host time vs the rest). */
  host: HostRollup & { sideNav: HostRouteStat[] };
}

/** One session for the attached file, its ids hashed by the caller. */
export interface AnonSession {
  session: string;
  member: string;
  os: PerfOs;
  shell: string;
  app: string;
  device: { mem?: number; cores?: number; model?: string };
  first: number;
  last: number;
  batches: number;
  missing: number;
  fgMs: number;
  launch?: { fcp?: number; hydrated?: number };
  nav: { n: number; p50: number; p95: number; max: number };
  longTaskMs: number;
  freezes: { n: number; max: number };
  rage: number;
  slowTaps: number;
  heap?: { first: number; last: number; max: number };
  domMax?: number;
  sideNav: { taps: number; abandoned: number };
}

const round = (n: number, digits = 0) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

function quantiles(values: number[]): Quantiles {
  return { n: values.length, p50: quantileOf(values, 0.5), p95: quantileOf(values, 0.95) };
}

const inWindow = (e: StoredDigest, since: number, until: number) => e.ts > since && e.ts <= until;

/** A window's batches grouped per session, each list in the order it was
 *  made. */
function bySession(entries: StoredDigest[]): StoredDigest[][] {
  const groups = new Map<string, StoredDigest[]>();
  for (const e of entries) {
    const key = `${e.userId}|${e.digest.session}`;
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }
  return [...groups.values()].map((list) => list.sort((a, b) => (a.digest.seq ?? 0) - (b.digest.seq ?? 0) || a.ts - b.ts));
}

/** A session's OS: the one its newest batch names (or derives). */
function sessionOs(list: StoredDigest[]): PerfOs {
  return digestOs(list[list.length - 1].digest);
}

type NavEvent = Extract<SessionEvent, { k: 'nav' }>;

function navEvents(list: StoredDigest[]): NavEvent[] {
  return list.flatMap((e) => (e.digest.ev ?? []).filter((ev): ev is NavEvent => ev.k === 'nav'));
}

/** Route timings: the batch's nav events, or its worst navs when it carried
 *  no events (they were dropped to fit). */
function routeSamples(list: StoredDigest[]): [string, number][] {
  const out: [string, number][] = [];
  for (const { digest: d } of list) {
    const evs = (d.ev ?? []).filter((ev): ev is NavEvent => ev.k === 'nav' && !ev.abandoned && typeof ev.ms === 'number');
    if (evs.length) for (const ev of evs) out.push([routeShape(ev.to), ev.ms!]);
    else for (const w of d.nav?.worst ?? []) out.push([routeShape(w.to), w.ms]);
  }
  return out;
}

function routeStats(samples: [string, number][]): RouteStat[] {
  const byRoute = new Map<string, number[]>();
  for (const [route, ms] of samples) {
    const list = byRoute.get(route);
    if (list) list.push(ms);
    else byRoute.set(route, [ms]);
  }
  return [...byRoute.entries()]
    .map(([route, ms]) => ({ route, n: ms.length, p50: quantileOf(ms, 0.5), p95: quantileOf(ms, 0.95), max: Math.max(...ms) }))
    .sort((a, b) => b.p95 - a.p95 || b.n - a.n || a.route.localeCompare(b.route));
}

function sideNavStats(events: NavEvent[], cap = SIDE_NAV_ROUTES): PlatformStats['sideNav'] {
  const byRoute = new Map<string, { ms: number[]; server: number[]; commit: number[]; abandoned: number }>();
  let taps = 0;
  let abandoned = 0;
  for (const ev of events) {
    if (ev.via !== 'tap' || !ev.area || !SIDE_NAV_AREAS.has(ev.area)) continue;
    const route = routeShape(ev.to);
    const r = byRoute.get(route) ?? { ms: [], server: [], commit: [], abandoned: 0 };
    byRoute.set(route, r);
    if (ev.abandoned) {
      r.abandoned++;
      abandoned++;
      continue;
    }
    if (typeof ev.ms !== 'number') continue;
    taps++;
    r.ms.push(ev.ms);
    if (typeof ev.server === 'number' && typeof ev.commit === 'number') {
      r.server.push(ev.server);
      r.commit.push(ev.commit);
    }
  }
  const routes = [...byRoute.entries()]
    .map(([route, r]) => ({
      route,
      n: r.ms.length,
      abandoned: r.abandoned,
      p50: quantileOf(r.ms, 0.5),
      p95: quantileOf(r.ms, 0.95),
      phased: r.server.length,
      serverP50: quantileOf(r.server, 0.5),
      commitP50: quantileOf(r.commit, 0.5),
    }))
    .sort((a, b) => b.n + b.abandoned - (a.n + a.abandoned) || b.p95 - a.p95 || a.route.localeCompare(b.route))
    .slice(0, cap);
  return { taps, abandoned, routes };
}

/** A session's device facts, merged over its batches (a batch cut to fit
 *  can lack the model). */
function sessionDevice(list: StoredDigest[]): DeviceFacts {
  return Object.assign({}, ...list.map((e) => e.digest.device ?? {})) as DeviceFacts;
}

function heapReadings(list: StoredDigest[]): number[] {
  return list.map((e) => e.digest.heap?.used).filter((n): n is number => typeof n === 'number');
}

function emptyStats(os: PerfOs, native: NativeCounts): PlatformStats {
  return platformStats(os, [], native);
}

const HEAP_SLOPES = 5;

function platformStats(os: PerfOs, sessions: StoredDigest[][], native: NativeCounts): PlatformStats {
  const all = sessions.flat();
  const members = new Set(all.map((e) => e.userId)).size;
  const shells: Record<string, number> = {};
  for (const list of sessions) {
    const s = shellLabel(list[list.length - 1].digest.shell);
    shells[s] = (shells[s] ?? 0) + 1;
  }
  let fg = 0;
  let lt = 0;
  let navN = 0;
  let navMax = 0;
  let freezeN = 0;
  let freezeMax = 0;
  let rage = 0;
  let slow = 0;
  let dom = 0;
  const navMs: number[] = [];
  const fcp: number[] = [];
  const hydrated: number[] = [];
  for (const { digest: d } of all) {
    fg += d.fgMs ?? 0;
    lt += d.lt?.ms ?? 0;
    if (d.nav) {
      navN += d.nav.n;
      navMs.push(...d.nav.ms);
      navMax = Math.max(navMax, ...d.nav.ms, ...(d.nav.worst ?? []).map((w) => w.ms));
    }
    if (d.freeze) {
      freezeN += d.freeze.n;
      freezeMax = Math.max(freezeMax, d.freeze.max);
    }
    rage += d.rage ?? 0;
    slow += d.slow?.n ?? 0;
    dom = Math.max(dom, d.dom ?? 0);
    if (typeof d.launch?.fcp === 'number') fcp.push(d.launch.fcp);
    if (typeof d.launch?.hydrated === 'number') hydrated.push(d.launch.hydrated);
  }
  const heaps = sessions.flatMap(heapReadings);
  const growth = sessions
    .map(heapReadings)
    .filter((h) => h.length >= 2)
    .map((h) => round(h[h.length - 1] - h[0], 1));
  const devices = sessions.map(sessionDevice);
  const mems = devices.map((d) => d.mem).filter((n): n is number => typeof n === 'number');
  const cores = devices.map((d) => d.cores).filter((n): n is number => typeof n === 'number');
  const fgMin = fg / 60_000;
  return {
    os,
    sessions: sessions.length,
    members,
    shells,
    fgHours: round(fg / 3_600_000, 2),
    launch: { fcp: quantiles(fcp), hydrated: quantiles(hydrated) },
    nav: { n: navN, p50: quantileOf(navMs, 0.5), p95: quantileOf(navMs, 0.95), max: navMax },
    longTaskMsPerMin: fgMin > 0 ? round(lt / fgMin) : 0,
    freezes: { n: freezeN, max: freezeMax },
    rageTaps: rage,
    slowTaps: slow,
    heap: {
      readings: heaps.length,
      p50: quantileOf(heaps, 0.5),
      max: heaps.length ? Math.max(...heaps) : 0,
      growth: {
        sessions: growth.length,
        p50: quantileOf(growth, 0.5),
        p95: quantileOf(growth, 0.95),
        max: growth.length ? Math.max(...growth) : 0,
      },
    },
    domMax: dom,
    device: {
      ...(mems.length ? { memGb: quantileOf(mems, 0.5) } : {}),
      ...(cores.length ? { cores: quantileOf(cores, 0.5) } : {}),
    },
    slowestRoutes: routeStats(sessions.flatMap(routeSamples)).slice(0, TOP_ROUTES),
    sideNav: sideNavStats(sessions.flatMap(navEvents)),
    native,
    heapSlopes: heapSlopes(all).slice(0, HEAP_SLOPES),
  };
}

/** The window's batches (`since` exclusive, `until` inclusive) summed up per
 *  platform, with the host's timing lines and the native apps' perf events
 *  from the server log (`server`) in the same window. Every platform is
 *  there, empty or not. */
export function buildPlatformRollup(entries: StoredDigest[], since: number, until: number, server: ServerLogEntry[] = []): PlatformRollup {
  const sessions = bySession(entries.filter((e) => inWindow(e, since, until)));
  const serverIn = server.filter((e) => e.ts > since && e.ts <= until);
  const native = nativeByOs(serverIn);
  const grouped = new Map<PerfOs, StoredDigest[][]>();
  for (const list of sessions) {
    const os = sessionOs(list);
    const g = grouped.get(os);
    if (g) g.push(list);
    else grouped.set(os, [list]);
  }
  const order: PerfOs[] = [...ROLLUP_PLATFORMS, 'other'];
  const byOs = Object.fromEntries(order.map((os) => [os, grouped.get(os)?.length ?? 0])) as Record<PerfOs, number>;
  const platforms = order.map((os) => {
    const n = native.get(os) ?? emptyNative();
    return grouped.has(os) ? platformStats(os, grouped.get(os)!, n) : emptyStats(os, n);
  });
  const host = buildHostRollup(serverIn);
  const sideNavRoutes = [...new Set(platforms.flatMap((p) => p.sideNav.routes.map((r) => r.route)))];
  const sideNav = sideNavRoutes.map((r) => hostForPage(host, r)).filter((r): r is HostRouteStat => !!r);
  return {
    since,
    until,
    totals: {
      sessions: sessions.length,
      members: new Set(sessions.map((l) => l[0].userId)).size,
      batches: sessions.reduce((n, l) => n + l.length, 0),
      byOs,
    },
    platforms,
    host: { ...host, sideNav },
  };
}

/** One row per session for the attached file, newest first, with the
 *  member and session ids passed through `anon` (a salted hash): enough to
 *  tell sessions apart, not to say whose they are. */
export function anonSessions(
  entries: StoredDigest[],
  since: number,
  until: number,
  anon: (kind: 'member' | 'session', id: string) => string,
): AnonSession[] {
  return bySession(entries.filter((e) => inWindow(e, since, until)))
    .map((list): AnonSession => {
      const last = list[list.length - 1].digest;
      const navMs = list.flatMap((e) => e.digest.nav?.ms ?? []);
      const heaps = heapReadings(list);
      const launch = list.find((e) => e.digest.launch)?.digest.launch;
      const side = sideNavStats(navEvents(list), 0);
      const device = sessionDevice(list);
      const doms = list.map((e) => e.digest.dom).filter((n): n is number => typeof n === 'number');
      return {
        session: anon('session', `${list[0].userId}|${last.session}`),
        member: anon('member', list[0].userId),
        os: sessionOs(list),
        shell: shellLabel(last.shell),
        app: last.app,
        device: {
          ...(typeof device.mem === 'number' ? { mem: device.mem } : {}),
          ...(typeof device.cores === 'number' ? { cores: device.cores } : {}),
          ...(device.model ? { model: device.model } : {}),
        },
        first: Math.min(...list.map((e) => e.ts)),
        last: Math.max(...list.map((e) => e.ts)),
        batches: list.length,
        missing: missingBatches(list).length,
        fgMs: Math.round(list.reduce((n, e) => n + (e.digest.fgMs ?? 0), 0)),
        ...(launch && (launch.fcp !== undefined || launch.hydrated !== undefined)
          ? { launch: { ...(launch.fcp !== undefined ? { fcp: launch.fcp } : {}), ...(launch.hydrated !== undefined ? { hydrated: launch.hydrated } : {}) } }
          : {}),
        nav: {
          n: list.reduce((n, e) => n + (e.digest.nav?.n ?? 0), 0),
          p50: quantileOf(navMs, 0.5),
          p95: quantileOf(navMs, 0.95),
          max: Math.max(0, ...navMs, ...list.flatMap((e) => (e.digest.nav?.worst ?? []).map((w) => w.ms))),
        },
        longTaskMs: Math.round(list.reduce((n, e) => n + (e.digest.lt?.ms ?? 0), 0)),
        freezes: {
          n: list.reduce((n, e) => n + (e.digest.freeze?.n ?? 0), 0),
          max: Math.max(0, ...list.map((e) => e.digest.freeze?.max ?? 0)),
        },
        rage: list.reduce((n, e) => n + (e.digest.rage ?? 0), 0),
        slowTaps: list.reduce((n, e) => n + (e.digest.slow?.n ?? 0), 0),
        ...(heaps.length ? { heap: { first: heaps[0], last: heaps[heaps.length - 1], max: Math.max(...heaps) } } : {}),
        ...(doms.length ? { domMax: Math.max(...doms) } : {}),
        sideNav: { taps: side.taps, abandoned: side.abandoned },
      };
    })
    .sort((a, b) => b.last - a.last);
}
