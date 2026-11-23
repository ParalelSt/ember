import { quantileOf } from './histogram';
import type { DeviceFacts, LaunchRecord, PerfDigest } from './types';

/** Stored perf digests read back per page session, for the admin's perf
 *  API (app/api/admin/perf) and `npm run perf`. Pure: no files, no server. */

export interface StoredDigest {
  ts: number;
  userId: string;
  digest: PerfDigest;
}

export interface PerfSessionSummary {
  session: string;
  userId: string;
  app: string;
  shell: string;
  device: DeviceFacts;
  first: number;
  last: number;
  digests: number;
  /** Foreground time the digests cover. */
  fgMs: number;
  launch?: LaunchRecord;
  nav: { n: number; p50: number; p95: number; max: number };
  longTaskMs: number;
  freezes: { n: number; max: number };
  rage: number;
  slowTaps: number;
  heap?: { first: number; last: number; max: number };
}

export interface PerfTimelineRow {
  ts: number;
  fgMs: number;
  launch?: LaunchRecord;
  lt?: PerfDigest['lt'];
  nav?: PerfDigest['nav'];
  slow?: PerfDigest['slow'];
  freeze?: PerfDigest['freeze'];
  rage?: number;
  heap?: PerfDigest['heap'];
  dom?: number;
  api?: PerfDigest['api'];
}

export const SESSION_LIST_CAP = 200;
export const TIMELINE_CAP = 500;

/** One summary per page session, the most recently heard first. */
export function summarizeSessions(entries: StoredDigest[], cap = SESSION_LIST_CAP): PerfSessionSummary[] {
  const groups = new Map<string, StoredDigest[]>();
  for (const e of entries) {
    const key = `${e.userId}|${e.digest.session}`;
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }
  const out: PerfSessionSummary[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.ts - b.ts);
    const lastD = list[list.length - 1].digest;
    const navMs: number[] = [];
    let navN = 0;
    let navMax = 0;
    let lt = 0;
    let freezeN = 0;
    let freezeMax = 0;
    let rage = 0;
    let slow = 0;
    let fg = 0;
    let launch: LaunchRecord | undefined;
    const heaps: number[] = [];
    for (const { digest: d } of list) {
      fg += d.fgMs;
      if (d.launch && !launch) launch = d.launch;
      if (d.nav) {
        navN += d.nav.n;
        navMs.push(...d.nav.ms);
        navMax = Math.max(navMax, ...d.nav.ms, ...(d.nav.worst ?? []).map((w) => w.ms));
      }
      if (d.lt) lt += d.lt.ms;
      if (d.freeze) {
        freezeN += d.freeze.n;
        freezeMax = Math.max(freezeMax, d.freeze.max);
      }
      rage += d.rage ?? 0;
      slow += d.slow?.n ?? 0;
      if (d.heap) heaps.push(d.heap.used);
    }
    out.push({
      session: lastD.session,
      userId: list[0].userId,
      app: lastD.app,
      shell: lastD.shell,
      device: lastD.device,
      first: list[0].ts,
      last: list[list.length - 1].ts,
      digests: list.length,
      fgMs: Math.round(fg),
      ...(launch ? { launch } : {}),
      nav: { n: navN, p50: quantileOf(navMs, 0.5), p95: quantileOf(navMs, 0.95), max: navMax },
      longTaskMs: Math.round(lt),
      freezes: { n: freezeN, max: freezeMax },
      rage,
      slowTaps: slow,
      ...(heaps.length ? { heap: { first: heaps[0], last: heaps[heaps.length - 1], max: Math.max(...heaps) } } : {}),
    });
  }
  return out.sort((a, b) => b.last - a.last).slice(0, cap);
}

/** One session's digests in time order. */
export function sessionTimeline(entries: StoredDigest[], session: string, cap = TIMELINE_CAP): PerfTimelineRow[] {
  return entries
    .filter((e) => e.digest.session === session)
    .sort((a, b) => a.ts - b.ts)
    .slice(-cap)
    .map(({ ts, digest: d }) => {
      const row: PerfTimelineRow = { ts, fgMs: d.fgMs };
      if (d.launch) row.launch = d.launch;
      if (d.lt) row.lt = d.lt;
      if (d.nav) row.nav = d.nav;
      if (d.slow) row.slow = d.slow;
      if (d.freeze) row.freeze = d.freeze;
      if (d.rage) row.rage = d.rage;
      if (d.heap) row.heap = d.heap;
      if (d.dom !== undefined) row.dom = d.dom;
      if (d.api) row.api = d.api;
      return row;
    });
}
