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

/** The periodic digest sent to POST /api/perf-log, at most 2 KB. */
export interface PerfDigest {
  v: 1;
  session: string;
  app: string;
  shell: string;
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
}
