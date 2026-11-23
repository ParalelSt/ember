import { quantileOf } from '@/lib/perf/histogram';
import type { StoredDigest } from '@/lib/perf/sessions';
import type { ServerLogEntry } from '@/lib/logger/types';

/** The daily digest's performance section (docs/android-performance.md
 *  5.5): launch and navigation medians and p95 from the members' perf
 *  digests, the host's slowest routes and event loop from its own timing
 *  lines, renderer deaths and low memory from the phone app's log, and heap
 *  growth per device model. Pure: the digest job hands it what it read. */

/** Native event names (PlaybackLog, native slice 4) counted here. */
const RENDERER_GONE = /^renderer\.(gone|crash)/;
const RENDERER_STUCK = /^renderer\.unresponsive/;
const LOW_MEMORY = /^memory\.(low|trim)/;

/** The native entries this section reads, so the digest job keeps them
 *  while reading (they are mostly info lines, which it otherwise skips). */
export function isPerfNativeEntry(e: ServerLogEntry): boolean {
  if (e.category !== 'native') return false;
  const ev = (e.data as { event?: unknown } | undefined)?.event;
  return typeof ev === 'string' && (RENDERER_GONE.test(ev) || RENDERER_STUCK.test(ev) || LOW_MEMORY.test(ev));
}

export interface PerfSection {
  lines: string[];
  /** For digest.json. */
  numbers: Record<string, unknown>;
}

const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

interface RouteAgg {
  n: number;
  p95: number;
  max: number;
}

export function buildPerfSection(input: { digests: StoredDigest[]; server: ServerLogEntry[] }): PerfSection | null {
  const { digests, server } = input;
  const lines: string[] = [];
  const numbers: Record<string, unknown> = {};

  const sessions = new Set(digests.map((d) => `${d.userId}|${d.digest.session}`));
  const devices = new Set(digests.map((d) => `${d.userId}|${d.digest.device.model ?? d.digest.shell}`));
  if (digests.length) lines.push(`${sessions.size} session${sessions.size === 1 ? '' : 's'} on ${devices.size} device${devices.size === 1 ? '' : 's'}`);

  const launches = digests.map((d) => d.digest.launch?.hydrated).filter((n): n is number => typeof n === 'number');
  if (launches.length) {
    numbers.launch = { n: launches.length, p50: quantileOf(launches, 0.5), p95: quantileOf(launches, 0.95) };
    lines.push(`Launch to ready: median ${s(quantileOf(launches, 0.5))}, p95 ${s(quantileOf(launches, 0.95))} (${launches.length})`);
  }

  const navs = digests.flatMap((d) => d.digest.nav?.ms ?? []);
  const worst = digests.flatMap((d) => d.digest.nav?.worst ?? []).sort((a, b) => b.ms - a.ms)[0];
  if (navs.length) {
    numbers.nav = { n: navs.length, p50: quantileOf(navs, 0.5), p95: quantileOf(navs, 0.95), worst };
    lines.push(
      `Navigation: median ${s(quantileOf(navs, 0.5))}, p95 ${s(quantileOf(navs, 0.95))} (${navs.length})` +
        (worst ? `, slowest ${worst.to} ${s(worst.ms)}` : ''),
    );
  }

  let freezes = 0;
  let freezeMax = 0;
  let rage = 0;
  for (const { digest: d } of digests) {
    freezes += d.freeze?.n ?? 0;
    freezeMax = Math.max(freezeMax, d.freeze?.max ?? 0);
    rage += d.rage ?? 0;
  }
  if (freezes || rage) {
    numbers.freezes = { n: freezes, max: freezeMax, rage };
    lines.push(`Freezes: ${freezes}${freezes ? ` (longest ${s(freezeMax)})` : ''}, rage taps ${rage}`);
  }

  // The host's own timing lines (lib/perf/serverTiming.ts).
  const routes = new Map<string, RouteAgg>();
  let loopP99 = 0;
  let slowRequests = 0;
  for (const e of server) {
    if (e.category !== 'perf' || e.message !== 'server timing') continue;
    const data = e.data as { routes?: { route: string; n: number; p95: number; max: number; held?: boolean }[]; slow?: number; health?: { loopP99?: number } };
    slowRequests += data?.slow ?? 0;
    loopP99 = Math.max(loopP99, data?.health?.loopP99 ?? 0);
    for (const r of data?.routes ?? []) {
      if (r.held) continue;
      const a = routes.get(r.route) ?? { n: 0, p95: 0, max: 0 };
      a.n += r.n;
      a.p95 = Math.max(a.p95, r.p95);
      a.max = Math.max(a.max, r.max);
      routes.set(r.route, a);
    }
  }
  if (routes.size) {
    const top = [...routes.entries()]
      .filter(([, a]) => a.n >= 3)
      .sort((a, b) => b[1].p95 - a[1].p95)
      .slice(0, 3);
    numbers.host = { routes: Object.fromEntries(top), loopP99, slowRequests };
    const routeText = top.map(([r, a]) => `${r} p95 ${a.p95} ms`).join(', ') || 'none busy';
    lines.push(`Host: slowest routes ${routeText}; event loop p99 up to ${loopP99} ms; ${slowRequests} slow request${slowRequests === 1 ? '' : 's'}`);
  }

  let gone = 0;
  let stuck = 0;
  let lowMem = 0;
  for (const e of server) {
    if (!isPerfNativeEntry(e)) continue;
    const ev = (e.data as { event: string }).event;
    if (RENDERER_GONE.test(ev)) gone++;
    else if (RENDERER_STUCK.test(ev)) stuck++;
    else lowMem++;
  }
  if (gone || stuck || lowMem) {
    numbers.native = { rendererGone: gone, rendererUnresponsive: stuck, lowMemory: lowMem };
    lines.push(`Renderer deaths ${gone}, unresponsive ${stuck}, low memory ${lowMem}`);
  }

  const slopes = heapSlopes(digests);
  if (slopes.length) {
    numbers.heapSlope = slopes;
    lines.push(`Heap per hour: ${slopes.slice(0, 4).map((h) => `${h.model} ${h.mbPerHour >= 0 ? '+' : ''}${h.mbPerHour} MB (${h.sessions})`).join(', ')}`);
  }

  if (!lines.length) return null;
  return { lines, numbers };
}

/** Heap growth per hour per device model, from sessions with at least two
 *  heap readings 10 min or more apart. Fastest growing first. */
export function heapSlopes(digests: StoredDigest[]): { model: string; mbPerHour: number; sessions: number }[] {
  const bySession = new Map<string, StoredDigest[]>();
  for (const d of digests) {
    if (!d.digest.heap) continue;
    const key = `${d.userId}|${d.digest.session}`;
    const list = bySession.get(key);
    if (list) list.push(d);
    else bySession.set(key, [d]);
  }
  const byModel = new Map<string, number[]>();
  for (const list of bySession.values()) {
    list.sort((a, b) => a.ts - b.ts);
    const first = list[0];
    const last = list[list.length - 1];
    const hours = (last.ts - first.ts) / 3_600_000;
    if (hours < 1 / 6) continue;
    const slope = (last.digest.heap!.used - first.digest.heap!.used) / hours;
    const model = last.digest.device.model ?? last.digest.shell;
    const arr = byModel.get(model) ?? [];
    arr.push(slope);
    byModel.set(model, arr);
  }
  return [...byModel.entries()]
    .map(([model, arr]) => ({ model, mbPerHour: Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10, sessions: arr.length }))
    .sort((a, b) => b.mbPerHour - a.mbPerHour);
}
