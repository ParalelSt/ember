import { Histogram } from './histogram';
import { NavTracker, targetLabel, type NavHost, type RscTiming } from './nav';
import { Ring } from './ring';
import { isRscUrl, routeShape } from './route';
import type {
  ApiRouteStat,
  DeviceFacts,
  FreezeRecord,
  LaunchRecord,
  LongTaskSummary,
  MemorySample,
  NavRecord,
  PerfBlock,
  RageRecord,
  SlowInteraction,
} from './types';

/** Page perf core (docs/android-performance.md, section 5.2). Framework
 *  free. Only passive observers and two slow timers (a 2 s heartbeat and a
 *  60 s memory sample), both stopped while the page is hidden. Everything is
 *  kept in fixed size rings and counters; nothing is serialized here. */

export const PERF_LIMITS = {
  heartbeatMs: 2000,
  /** A heartbeat later than this past its time is a freeze. */
  freezeDriftMs: 2000,
  /** A gap longer than this is the device asleep or the WebView suspended
   *  (timers stop then), not a freeze. */
  suspendMs: 60_000,
  memoryEveryMs: 60_000,
  slowInteractionMs: 100,
  navs: 20,
  slow: 20,
  freezes: 10,
  rage: 10,
  memory: 30,
  apiRoutes: 40,
  ltSources: 20,
  counters: 20,
  /** Events kept for the next batch; older ones are dropped and counted. */
  events: 60,
} as const;

/** What a record listener hears: a finished launch, navigation or freeze,
 *  and the page being hidden (lib/perf/client.ts sends a batch then). */
export type PerfEvent =
  | { kind: 'launch'; ms: number }
  | { kind: 'nav'; rec: NavRecord }
  | { kind: 'freeze'; rec: FreezeRecord }
  | { kind: 'hide' };

/** The browser pieces the core touches, swappable in tests. */
export interface PerfEnv {
  win: Window;
  doc: Document;
  perf: Performance;
  PO?: typeof PerformanceObserver;
}

interface LongTaskAgg {
  n: number;
  ms: number;
  max: number;
  sources: Map<string, number>;
}

/** A record waiting for the next batch. Kept by reference: a slow tap's
 *  record can still grow until it is sent. */
export type PendingEvent =
  | { k: 'nav'; r: NavRecord }
  | { k: 'freeze'; r: FreezeRecord }
  | { k: 'rage'; r: RageRecord }
  | { k: 'slow'; r: SlowInteraction };

function newWindow() {
  return {
    fgMs: 0,
    navN: 0,
    navMs: [] as number[],
    navWorst: [] as NavRecord[],
    slowN: 0,
    slowMax: 0,
    freezeN: 0,
    freezeMax: 0,
    rage: 0,
    events: [] as PendingEvent[],
    evDropped: 0,
  };
}

export type PerfWindow = ReturnType<typeof newWindow> & { lt: LongTaskSummary };

function newAgg(): LongTaskAgg {
  return { n: 0, ms: 0, max: 0, sources: new Map() };
}

function addToAgg(agg: LongTaskAgg, ms: number, source: string, cap: number): void {
  agg.n++;
  agg.ms += ms;
  if (ms > agg.max) agg.max = ms;
  const key = agg.sources.has(source) || agg.sources.size < cap ? source : 'other';
  agg.sources.set(key, (agg.sources.get(key) ?? 0) + ms);
}

function summarize(agg: LongTaskAgg, top: number): LongTaskSummary {
  const sources = [...agg.sources.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
  return {
    n: agg.n,
    ms: Math.round(agg.ms),
    max: Math.round(agg.max),
    top: sources.map(([s, ms]) => [s, Math.round(ms)]),
  };
}

/** A script URL cut to its file name: no host, no query. */
export function shortSource(url: string | undefined): string {
  if (!url) return '';
  const path = url.split(/[?#]/)[0];
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.slice(0, 60);
}

const MB = 1024 * 1024;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Device facts that never change during a session. */
export function deviceFacts(nav: Navigator | undefined): DeviceFacts {
  if (!nav) return {};
  const n = nav as Navigator & { deviceMemory?: number; connection?: { effectiveType?: string } };
  const out: DeviceFacts = {};
  if (typeof n.deviceMemory === 'number') out.mem = n.deviceMemory;
  if (typeof n.hardwareConcurrency === 'number') out.cores = n.hardwareConcurrency;
  const model = /Android [\d.]+; ([^;)]+)/.exec(n.userAgent ?? '')?.[1]?.trim();
  if (model && model !== 'K') out.model = model.slice(0, 40);
  if (n.connection?.effectiveType) out.net = n.connection.effectiveType;
  return out;
}

export class PagePerf {
  on = false;
  offReason?: string;
  private started = false;
  private env: PerfEnv | null = null;
  private observers: PerformanceObserver[] = [];
  private cleanups: (() => void)[] = [];
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private memTimer: ReturnType<typeof setInterval> | null = null;
  private lastBeat = 0;
  private visibleSince: number | null = null;
  private listeners = new Set<(e: PerfEvent) => void>();
  private sizeSources = new Map<string, () => number>();
  private playingSource: () => boolean = () => false;
  private nav: NavTracker;

  readonly launch: LaunchRecord = {};
  private launchDone = false;
  private ltSession = newAgg();
  private ltWindow = newAgg();
  private ltTotalMs = 0;
  /** [end time, ms] of the last long tasks, for "long task ms in the last 5 s". */
  private ltRecent = new Ring<[number, number]>(20);
  private lastInteractionId = 0;
  readonly slow = new Ring<SlowInteraction>(PERF_LIMITS.slow);
  readonly freezes = new Ring<FreezeRecord>(PERF_LIMITS.freezes);
  readonly memory = new Ring<MemorySample>(PERF_LIMITS.memory);
  readonly rage = new Ring<RageRecord>(PERF_LIMITS.rage);
  readonly navs = new Ring<NavRecord>(PERF_LIMITS.navs);
  private rsc = new Ring<RscTiming>(6);
  private api = new Map<string, { h: Histogram; kb: number }>();
  private counters = new Map<string, number>();
  /** Since the last digest (lib/perf/digest.ts): reset by takeWindow(). */
  private win = newWindow();

  constructor() {
    const host: NavHost = {
      now: () => this.now(),
      ltTotal: () => this.ltTotalMs,
      ltSince: (ms) => {
        const from = this.now() - ms;
        return this.ltRecent.toArray().reduce((sum, [end, d]) => (end >= from ? sum + d : sum), 0);
      },
      findRsc: (path, after) => {
        const list = this.rsc.toArray();
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].path === path && list[i].start >= after) return list[i];
        }
        return undefined;
      },
      playing: () => {
        try {
          return this.playingSource();
        } catch {
          return false;
        }
      },
      afterPaint: (fn) => this.afterPaint(fn),
      later: (fn, ms) => {
        setTimeout(fn, ms);
      },
      addNav: (rec) => this.addNav(rec),
      addRage: (rec) => {
        if (!this.on) return;
        this.rage.push(rec);
        this.win.rage++;
        this.addEvent({ k: 'rage', r: rec });
      },
      doc: () => this.env!.doc,
      currentPath: () => this.env!.win.location.pathname,
    };
    this.nav = new NavTracker(host);
  }

  private now(): number {
    return this.env ? this.env.perf.now() : 0;
  }

  /** Starts observing. Once per page: after stop() it stays off. */
  start(env?: Partial<PerfEnv>): void {
    if (this.started || this.offReason || typeof window === 'undefined') return;
    this.started = true;
    this.env = {
      win: env?.win ?? window,
      doc: env?.doc ?? document,
      perf: env?.perf ?? performance,
      PO: env?.PO ?? (typeof PerformanceObserver === 'undefined' ? undefined : PerformanceObserver),
    };
    this.on = true;
    this.readNavigationTiming();
    this.observeAll();

    const { doc, win } = this.env;
    const onVisibility = () => (doc.visibilityState === 'hidden' ? this.onHidden() : this.onVisible());
    doc.addEventListener('visibilitychange', onVisibility);
    this.cleanups.push(() => doc.removeEventListener('visibilitychange', onVisibility));
    const onClick = (e: MouseEvent) => {
      if (this.on) this.nav.onClick(e);
    };
    doc.addEventListener('click', onClick, { capture: true });
    this.cleanups.push(() => doc.removeEventListener('click', onClick, { capture: true }));
    const onPageHide = () => this.onHidden();
    win.addEventListener('pagehide', onPageHide);
    this.cleanups.push(() => win.removeEventListener('pagehide', onPageHide));

    if (doc.visibilityState !== 'hidden') this.onVisible();
  }

  /** The kill switch: disconnects every observer, clears every timer and
   *  listener. What was recorded so far stays for a bug report. */
  stop(reason = 'off'): void {
    if (!this.on && this.offReason) return;
    this.on = false;
    this.offReason = reason;
    for (const o of this.observers) o.disconnect();
    this.observers = [];
    this.stopTimers();
    for (const c of this.cleanups) c();
    this.cleanups = [];
    this.listeners.clear();
  }

  onEvent(fn: (e: PerfEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: PerfEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch {
        // A listener must never break recording.
      }
    }
  }

  /** A size worth sampling with memory (queue length, logger ring, ...). */
  setSize(name: string, read: () => number): void {
    if (this.sizeSources.size < 10 || this.sizeSources.has(name)) this.sizeSources.set(name, read);
  }

  setPlaying(read: () => boolean): void {
    this.playingSource = read;
  }

  /** A plain counter (bounded number of names). */
  count(name: string, by = 1): void {
    if (!this.on) return;
    if (!this.counters.has(name) && this.counters.size >= PERF_LIMITS.counters) return;
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  /** React finished hydrating: LoggerInit's effect. Waits for the first idle
   *  moment, then reads the scripts loaded for the launch record. */
  markHydrated(): void {
    if (!this.on || this.launch.hydrated !== undefined) return;
    this.launch.hydrated = Math.round(this.now());
    const done = () => {
      if (!this.on || this.launchDone) return;
      this.launchDone = true;
      this.launch.idle = Math.round(this.now());
      this.readScripts();
      this.sampleMemory();
      this.emit({ kind: 'launch', ms: this.launch.hydrated ?? 0 });
    };
    const w = this.env!.win as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(done, { timeout: 5000 });
    else setTimeout(done, 0);
  }

  /** The route changed (lib/logger/client.ts route hook). */
  onRoute(path: string, from: string, how: 'push' | 'pop'): void {
    if (this.on) this.nav.onRoute(path, from, how);
  }

  // ── Observers ─────────────────────────────────────────────────────────

  private observe(type: string, cb: (entries: PerformanceEntry[]) => void, extra: Record<string, unknown> = {}): boolean {
    const PO = this.env?.PO;
    if (!PO) return false;
    const supported = (PO as unknown as { supportedEntryTypes?: readonly string[] }).supportedEntryTypes;
    if (supported && !supported.includes(type)) return false;
    try {
      const o = new PO((list) => {
        if (this.on) cb(list.getEntries());
      });
      o.observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
      this.observers.push(o);
      return true;
    } catch {
      return false;
    }
  }

  private observeAll(): void {
    if (!this.observe('long-animation-frame', (list) => this.onLoaf(list))) {
      this.observe('longtask', (list) => this.onLongTasks(list));
    }
    this.observe('event', (list) => this.onEvents(list), { durationThreshold: 104 });
    this.observe('paint', (list) => {
      for (const e of list) if (e.name === 'first-contentful-paint') this.launch.fcp = Math.round(e.startTime);
    });
    this.observe('resource', (list) => this.onResources(list));
  }

  private addLongTask(end: number, ms: number, source: string): void {
    addToAgg(this.ltSession, ms, source, PERF_LIMITS.ltSources);
    addToAgg(this.ltWindow, ms, source, 10);
    this.ltTotalMs += ms;
    this.ltRecent.push([end, ms]);
  }

  private onLoaf(list: PerformanceEntry[]): void {
    for (const e of list) {
      const loaf = e as PerformanceEntry & {
        blockingDuration?: number;
        scripts?: { duration: number; sourceURL?: string; invoker?: string; invokerType?: string }[];
      };
      const ms = loaf.blockingDuration ?? Math.max(0, e.duration - 50);
      if (ms <= 0) continue;
      let source = '';
      let longest = -1;
      for (const s of loaf.scripts ?? []) {
        if (s.duration > longest) {
          longest = s.duration;
          source = shortSource(s.sourceURL) || s.invokerType || '';
        }
      }
      this.addLongTask(e.startTime + e.duration, ms, source || 'render');
    }
  }

  private onLongTasks(list: PerformanceEntry[]): void {
    for (const e of list) this.addLongTask(e.startTime + e.duration, e.duration, 'longtask');
  }

  private onEvents(list: PerformanceEntry[]): void {
    for (const e of list) {
      const ev = e as PerformanceEntry & {
        processingStart: number;
        processingEnd: number;
        interactionId?: number;
        target?: Element | null;
      };
      if (e.duration < PERF_LIMITS.slowInteractionMs) continue;
      if (!ev.interactionId) continue;
      const rec: SlowInteraction = {
        at: Math.round(e.startTime),
        type: e.name,
        ms: Math.round(e.duration),
        inputDelay: Math.round(ev.processingStart - e.startTime),
        handler: Math.round(ev.processingEnd - ev.processingStart),
        paint: Math.round(e.startTime + e.duration - ev.processingEnd),
      };
      if (ev.target) rec.target = targetLabel(ev.target);
      // pointerdown, pointerup and click of one tap share an interaction id:
      // keep the slowest of them as one record.
      const last = this.slow.last();
      if (ev.interactionId === this.lastInteractionId && last) {
        if (rec.ms > last.ms) Object.assign(last, rec);
        this.win.slowMax = Math.max(this.win.slowMax, rec.ms);
        continue;
      }
      this.lastInteractionId = ev.interactionId;
      this.slow.push(rec);
      this.addEvent({ k: 'slow', r: rec });
      this.win.slowN++;
      this.win.slowMax = Math.max(this.win.slowMax, rec.ms);
    }
  }

  private onResources(list: PerformanceEntry[]): void {
    for (const e of list) {
      const name = e.name;
      const rsc = isRscUrl(name);
      const apiAt = name.indexOf('/api/');
      if (!rsc && apiAt < 0) continue;
      const r = e as PerformanceResourceTiming;
      const kb = Math.round((r.transferSize || r.encodedBodySize || 0) / 1024);
      if (rsc) {
        let path = '';
        try {
          path = new URL(name).pathname;
        } catch {
          continue;
        }
        const st: Record<string, number> = {};
        for (const s of r.serverTiming ?? []) {
          if (Object.keys(st).length < 4) st[s.name.slice(0, 20)] = Math.round(s.duration);
        }
        this.rsc.push({
          path,
          start: r.startTime,
          requestStart: r.requestStart,
          responseStart: r.responseStart,
          responseEnd: r.responseEnd,
          kb,
          ...(Object.keys(st).length ? { st } : {}),
          ...(r.nextHopProtocol ? { proto: r.nextHopProtocol } : {}),
        });
        continue;
      }
      const route = routeShape(name.slice(apiAt));
      let stat = this.api.get(route);
      if (!stat) {
        if (this.api.size >= PERF_LIMITS.apiRoutes) {
          stat = this.api.get('other');
          if (!stat) this.api.set('other', (stat = { h: new Histogram(), kb: 0 }));
        } else {
          this.api.set(route, (stat = { h: new Histogram(), kb: 0 }));
        }
      }
      stat.h.add(r.responseStart > 0 ? r.responseStart - r.startTime : r.duration);
      stat.kb += kb;
    }
  }

  private readNavigationTiming(): void {
    try {
      const nav = this.env!.perf.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      if (!nav) return;
      if (nav.responseStart > 0) this.launch.ttfb = Math.round(nav.responseStart);
      if (nav.domContentLoadedEventEnd > 0) this.launch.domReady = Math.round(nav.domContentLoadedEventEnd);
      if (nav.nextHopProtocol) this.launch.proto = nav.nextHopProtocol;
    } catch {
      // No navigation timing: the launch record just has fewer fields.
    }
  }

  private readScripts(): void {
    try {
      let n = 0;
      let bytes = 0;
      let cached = 0;
      for (const e of this.env!.perf.getEntriesByType('resource') as PerformanceResourceTiming[]) {
        if (e.initiatorType !== 'script' && !/\.js(\?|$)/.test(e.name)) continue;
        n++;
        bytes += e.transferSize || 0;
        if (e.transferSize === 0 && e.decodedBodySize > 0) cached++;
      }
      this.launch.scripts = n;
      this.launch.scriptKb = Math.round(bytes / 1024);
      this.launch.cached = cached;
    } catch {
      // Same: fewer fields.
    }
  }

  // ── Timers (only while visible) ───────────────────────────────────────

  private onVisible(): void {
    if (!this.on || this.heartbeat) return;
    this.visibleSince = this.now();
    this.lastBeat = this.now();
    this.heartbeat = setInterval(() => this.beat(), PERF_LIMITS.heartbeatMs);
    this.memTimer = setInterval(() => this.sampleMemory(), PERF_LIMITS.memoryEveryMs);
  }

  private onHidden(): void {
    if (this.visibleSince !== null) {
      this.win.fgMs += this.now() - this.visibleSince;
      this.visibleSince = null;
    }
    this.stopTimers();
    if (this.on) this.emit({ kind: 'hide' });
  }

  private stopTimers(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.memTimer) clearInterval(this.memTimer);
    this.heartbeat = null;
    this.memTimer = null;
  }

  private beat(): void {
    const now = this.now();
    const before = this.lastBeat;
    const gap = now - before;
    this.lastBeat = now;
    if (gap > PERF_LIMITS.suspendMs) {
      // Asleep: no freeze, and the time away is not foreground time.
      if (this.visibleSince !== null) {
        this.win.fgMs += Math.max(0, before - this.visibleSince);
        this.visibleSince = now;
      }
      return;
    }
    if (gap - PERF_LIMITS.heartbeatMs <= PERF_LIMITS.freezeDriftMs) return;
    const rec: FreezeRecord = { at: Math.round(now - gap), gapMs: Math.round(gap) };
    this.freezes.push(rec);
    this.addEvent({ k: 'freeze', r: rec });
    this.win.freezeN++;
    this.win.freezeMax = Math.max(this.win.freezeMax, rec.gapMs);
    this.emit({ kind: 'freeze', rec });
  }

  /** One memory sample: heap where the browser tells it, DOM size, and the
   *  app's sizes. Also called by the digest so it carries a fresh one. */
  sampleMemory(): MemorySample | undefined {
    if (!this.on || !this.env) return undefined;
    const pm = (this.env.perf as Performance & {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
    }).memory;
    const sample: MemorySample = { at: Math.round(this.now()), dom: this.env.doc.getElementsByTagName('*').length };
    if (pm) {
      sample.used = round1(pm.usedJSHeapSize / MB);
      sample.total = round1(pm.totalJSHeapSize / MB);
      sample.limit = Math.round(pm.jsHeapSizeLimit / MB);
    }
    if (this.sizeSources.size) {
      const sizes: Record<string, number> = {};
      for (const [name, read] of this.sizeSources) {
        try {
          const v = read();
          if (Number.isFinite(v)) sizes[name] = v;
        } catch {
          // One bad source never costs the sample.
        }
      }
      sample.sizes = sizes;
    }
    this.memory.push(sample);
    return sample;
  }

  private afterPaint(fn: () => void): void {
    const w = this.env!.win;
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      fn();
    };
    if (typeof w.requestAnimationFrame === 'function') w.requestAnimationFrame(() => setTimeout(run, 0));
    // A hidden page draws no frames: do not wait forever.
    setTimeout(run, 1000);
  }

  private addNav(rec: NavRecord): void {
    if (!this.on) return;
    this.navs.push(rec);
    this.addEvent({ k: 'nav', r: rec });
    if (rec.total !== undefined && !rec.abandoned) {
      const w = this.win;
      w.navN++;
      if (w.navMs.length < 20) w.navMs.push(rec.total);
      // The two slowest of the window, in short form for the digest.
      w.navWorst.push(rec);
      w.navWorst.sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
      if (w.navWorst.length > 2) w.navWorst.length = 2;
    }
    this.emit({ kind: 'nav', rec });
  }

  private addEvent(e: PendingEvent): void {
    const list = this.win.events;
    if (list.length >= PERF_LIMITS.events) {
      list.shift();
      this.win.evDropped++;
    }
    list.push(e);
  }

  // ── Reading it out ────────────────────────────────────────────────────

  apiStats(top: number = PERF_LIMITS.apiRoutes): ApiRouteStat[] {
    return [...this.api.entries()]
      .map(([route, { h, kb }]) => ({ route, n: h.count, p50: Math.round(h.quantile(0.5)), max: Math.round(h.max), kb }))
      .sort((a, b) => b.max - a.max)
      .slice(0, top);
  }

  longTasks(): LongTaskSummary {
    return summarize(this.ltSession, 5);
  }

  /** The perf block for a bug report (section 5.5). */
  block(): PerfBlock {
    const nav = typeof navigator === 'undefined' ? undefined : navigator;
    return {
      on: this.on,
      ...(this.offReason ? { off: this.offReason } : {}),
      uptimeMs: Math.round(this.now()),
      launch: { ...this.launch },
      longTasks: this.longTasks(),
      navs: this.navs.toArray(),
      slow: this.slow.toArray(),
      freezes: this.freezes.toArray(),
      rage: this.rage.toArray(),
      memory: this.memory.toArray(),
      api: this.apiStats(15),
      counts: Object.fromEntries(this.counters),
      device: deviceFacts(nav),
    };
  }

  /** What happened since the last call, for the periodic digest; resets
   *  the window. */
  takeWindow(): PerfWindow {
    if (this.visibleSince !== null) {
      const now = this.now();
      this.win.fgMs += now - this.visibleSince;
      this.visibleSince = now;
    }
    const out = { ...this.win, lt: summarize(this.ltWindow, 3) };
    this.win = newWindow();
    this.ltWindow = newAgg();
    return out;
  }

  /** Foreground ms not yet taken by a digest. */
  pendingForegroundMs(): number {
    return this.win.fgMs + (this.visibleSince !== null ? this.now() - this.visibleSince : 0);
  }

  /** True once the launch record is complete (it goes in the first digest). */
  launchReady(): boolean {
    return this.launchDone;
  }
}
