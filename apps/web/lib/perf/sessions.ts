import { quantileOf } from './histogram';
import type { DeviceFacts, LaunchRecord, PerfDigest, SessionEvent } from './types';

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
  /** Batches the host has, and the numbers of any that never arrived. */
  digests: number;
  missing: number[];
  /** Events the batches carried, by kind. */
  events: Record<string, number>;
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
  seq: number;
  evDropped?: number;
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

/** One event of a session at its wall time, with the batch it came in. */
export type TimedEvent = SessionEvent & { ts: number; seq: number };

export const SESSION_LIST_CAP = 200;
export const TIMELINE_CAP = 500;
export const EVENTS_CAP = 5000;

/** A session's batches in the order they were made (by number, then by
 *  arrival), whatever order they were stored in. */
function inOrder(list: StoredDigest[]): StoredDigest[] {
  return list.sort((a, b) => (a.digest.seq ?? 0) - (b.digest.seq ?? 0) || a.ts - b.ts);
}

/** Numbers between 1 and the highest batch number that never arrived. */
export function missingBatches(list: StoredDigest[]): number[] {
  const seen = new Set(list.map((e) => e.digest.seq).filter((n): n is number => typeof n === 'number'));
  const max = Math.max(0, ...seen);
  const out: number[] = [];
  for (let i = 1; i <= max && out.length < 50; i++) if (!seen.has(i)) out.push(i);
  return out;
}

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
    inOrder(list);
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
    const events: Record<string, number> = {};
    for (const { digest: d } of list) {
      for (const ev of d.ev ?? []) events[ev.k] = (events[ev.k] ?? 0) + 1;
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
      first: Math.min(...list.map((e) => e.ts)),
      last: Math.max(...list.map((e) => e.ts)),
      digests: list.length,
      missing: missingBatches(list),
      events,
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

/** One session's batches in the order they were made. */
export function sessionTimeline(entries: StoredDigest[], session: string, cap = TIMELINE_CAP): PerfTimelineRow[] {
  return inOrder(entries.filter((e) => e.digest.session === session))
    .slice(-cap)
    .map(({ ts, digest: d }) => {
      const row: PerfTimelineRow = { ts, seq: d.seq ?? 0, fgMs: d.fgMs };
      if (d.launch) row.launch = d.launch;
      if (d.lt) row.lt = d.lt;
      if (d.nav) row.nav = d.nav;
      if (d.slow) row.slow = d.slow;
      if (d.freeze) row.freeze = d.freeze;
      if (d.rage) row.rage = d.rage;
      if (d.heap) row.heap = d.heap;
      if (d.dom !== undefined) row.dom = d.dom;
      if (d.api) row.api = d.api;
      if (d.evDropped) row.evDropped = d.evDropped;
      return row;
    });
}

/** Every event of one session, merged across its batches, in the order
 *  they happened (the page's start plus each event's time). */
export function sessionEvents(entries: StoredDigest[], session: string, cap = EVENTS_CAP): TimedEvent[] {
  const out: TimedEvent[] = [];
  for (const { ts, digest: d } of inOrder(entries.filter((e) => e.digest.session === session))) {
    const t0 = typeof d.t0 === 'number' ? d.t0 : undefined;
    for (const ev of d.ev ?? []) out.push({ ...ev, ts: t0 !== undefined ? Math.round(t0 + ev.at) : ts, seq: d.seq ?? 0 });
  }
  return out.sort((a, b) => a.ts - b.ts).slice(-cap);
}
