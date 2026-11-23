import type { PerfOs } from './os';

/** Page perf records (docs/android-performance.md, section 5.2). All times
 *  are whole milliseconds; `at` fields are ms since the page started
 *  (performance.now()), so no record carries the wall clock twice. */

export interface LaunchRecord {
  /** First byte of the document. */
  ttfb?: number;
  domReady?: number;
  /** First contentful paint. */
  fcp?: number;
  /** React finished hydrating (LoggerInit's effect ran). */
  hydrated?: number;
  /** The first idle moment after hydrating. */
  idle?: number;
  /** Scripts loaded so far: count, KB over the wire, how many came from cache. */
  scripts?: number;
  scriptKb?: number;
  cached?: number;
  /** The document's protocol (h2, http/1.1, h3). */
  proto?: string;
}

export interface LongTaskSummary {
  n: number;
  ms: number;
  max: number;
  /** Up to 5 script sources with the most blocking time, [source, ms]. */
  top: [string, number][];
}

export interface SlowInteraction {
  at: number;
  /** click, pointerdown, keydown, ... */
  type: string;
  ms: number;
  inputDelay: number;
  handler: number;
  /** From the end of the handlers to the next paint. */
  paint: number;
  /** aria-label, data-nav or data-slot of the target, never its text. */
  target?: string;
}

export interface FreezeRecord {
  at: number;
  gapMs: number;
}

export interface MemorySample {
  at: number;
  /** performance.memory, MB (Chromium only). */
  used?: number;
  total?: number;
  limit?: number;
  dom: number;
  /** Extra sizes from the app (queue length, logger ring, ...). */
  sizes?: Record<string, number>;
}

/** The nav a tapped link sits in: the side nav (computer), the drawer
 *  (phone) or the bottom bar. */
export type NavArea = 'sidebar' | 'drawer' | 'bottom';

/** One client navigation, split as in section 3 of the doc. */
export interface NavRecord {
  at: number;
  from: string;
  to: string;
  /** How it started: a tapped link, back/forward, or code (router.push). */
  via: 'tap' | 'pop' | 'push';
  /** Tap (or start) to the new route being shown. */
  total?: number;
  tapToRequest?: number;
  /** Request start to sent: waiting for a free connection. */
  queue?: number;
  /** Sent to first byte: host and network. */
  server?: number;
  download?: number;
  kb?: number;
  /** Response end to the route change. */
  commit?: number;
  /** Route change to the next frame. */
  paint?: number;
  /** Server-Timing entries from the host, name to ms. */
  st?: Record<string, number>;
  proto?: string;
  /** Long task ms while it was pending. */
  lt: number;
  playing?: boolean;
  /** Replaced by another tap before it finished. */
  abandoned?: boolean;
  /** A tap on a link in one of the app's navs. */
  area?: NavArea;
}

export interface RageRecord {
  at: number;
  target: string;
  taps: number;
  /** A navigation was still waiting, and for how long. */
  pendingMs?: number;
  /** What is under the finger: its data-slot or role. */
  under?: string;
  overlay: boolean;
  inert: boolean;
  /** Long task ms in the 5 s before. */
  lt: number;
}

export interface ApiRouteStat {
  route: string;
  n: number;
  p50: number;
  max: number;
  kb: number;
}

/** The perf block in a bug report or automatic report (section 5.5). */
export interface PerfBlock {
  on: boolean;
  /** Why it is off: 'host', 'sample', 'unsupported'. */
  off?: string;
  uptimeMs: number;
  launch: LaunchRecord;
  longTasks: LongTaskSummary;
  navs: NavRecord[];
  slow: SlowInteraction[];
  freezes: FreezeRecord[];
  rage: RageRecord[];
  memory: MemorySample[];
  api: ApiRouteStat[];
  counts: Record<string, number>;
  device: DeviceFacts;
}

export interface DeviceFacts {
  /** navigator.deviceMemory, GB (Chromium only, rounded by the browser). */
  mem?: number;
  cores?: number;
  /** The phone model from the user agent, when it says one. */
  model?: string;
  net?: string;
}

/** One thing that happened, as a session's batch carries it. `at` is ms
 *  since the page started; the batch's `t0` turns it into a wall time. */
export type SessionEvent =
  | { k: 'nav'; at: number; to: string; via: string; ms?: number; server?: number; commit?: number; lt: number; playing?: boolean; abandoned?: boolean; area?: NavArea }
  | { k: 'freeze'; at: number; ms: number }
  | { k: 'rage'; at: number; target: string; taps: number; pending?: number; overlay: boolean; inert: boolean }
  | { k: 'slow'; at: number; type: string; ms: number; target?: string };

/** One batch of a page session, sent to POST /api/perf-log every 5 min and
 *  when the app is left: what happened since the batch before, at most
 *  6 KB. */
export interface PerfDigest {
  v: 1;
  session: string;
  /** The batch's number in its session, from 1: a gap means one was lost. */
  seq: number;
  /** When the page started (performance.timeOrigin), ms since 1970. */
  t0: number;
  app: string;
  shell: string;
  /** The operating system (lib/perf/os.ts). Batches from before it
   *  existed have none; the host fills it in from the request. */
  os?: PerfOs;
  device: DeviceFacts;
  /** Foreground ms this digest covers. */
  fgMs: number;
  launch?: LaunchRecord;
  lt?: { n: number; ms: number; max: number; top?: [string, number][] };
  /** Navigation totals (ms) and the slowest ones in short form. */
  nav?: { n: number; ms: number[]; worst?: { to: string; ms: number; server?: number; commit?: number }[] };
  slow?: { n: number; max: number };
  freeze?: { n: number; max: number };
  rage?: number;
  heap?: { used: number; limit?: number };
  dom?: number;
  api?: [string, number, number, number][];
  /** What happened since the batch before, oldest first. */
  ev?: SessionEvent[];
  /** Events left out of this batch (too many, or too big). */
  evDropped?: number;
}

/** The app's route tree (lib/perf/routeTree.ts), built from the app/
 *  folders: which segments are fixed words and where an id goes. */
export interface RouteNode {
  /** Static child segments. */
  s?: Record<string, RouteNode>;
  /** A dynamic child ([id], [slug], ...). */
  d?: RouteNode;
  /** A catch-all child ([...x]): the rest of the path. */
  c?: 1;
}
