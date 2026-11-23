import 'server-only';
import { Histogram } from './histogram';
import { routeShape } from './route';

/** Server request timing and host health (docs/android-performance.md 5.4).
 *  Every request is timed through Node's diagnostics_channel, so pages, RSC,
 *  API and files are covered alike with nothing patched. Per route (ids
 *  taken out, RSC marked): count, median, p95, max and status classes, in a
 *  bounded map. Every 5 min one `perf` line goes to the server log with the
 *  routes and the host's health, plus one warn line per request over 2 s
 *  (capped). Only the path is read: never a header value, cookie or body. */

export const SERVER_TIMING_LIMITS = {
  windowMs: 5 * 60 * 1000,
  slowMs: 2000,
  maxRoutes: 60,
  /** Routes in one perf line, the busiest by total time first. */
  routesPerLine: 25,
  slowLinesPerWindow: 20,
} as const;

/** Requests that are meant to last: audio and file streams, the held long
 *  poll of device control, app downloads. Timed, but never "slow". */
const HELD_ROUTE = /\/stream(\/|$)|\/remote\/beat|\/apk|\/asset\//;
const HELD_TYPE = /^(audio|video)\/|event-stream|octet-stream/;

export interface RequestLike {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
}

export interface ResponseLike {
  statusCode?: number;
  getHeader?(name: string): unknown;
}

export interface RouteStat {
  route: string;
  n: number;
  p50: number;
  p95: number;
  max: number;
  /** Status classes: 2xx..5xx counts. */
  s: Record<string, number>;
  held?: boolean;
}

export interface HostHealth {
  /** Event loop delay over the window, ms. */
  loopP50?: number;
  loopP99?: number;
  loopMax?: number;
  load: number[];
  rssMb: number;
  heapMb: number;
  downloads?: number;
  downloadsWaiting?: number;
  python?: number;
  pythonWaiting?: number;
}

export interface TimingSink {
  info(category: string, message: string, data?: unknown): void;
  warn(category: string, message: string, data?: unknown, err?: unknown, ctx?: { reqId?: string; route?: string }): void;
}

interface Stat {
  h: Histogram;
  s: Record<string, number>;
  held: boolean;
}

/** The route key of a request: its shape, with "(rsc)" for a router data
 *  request, so a page's HTML and its RSC answers are told apart. */
export function requestRoute(req: RequestLike): string {
  const url = req.url ?? '/';
  const rscHeader = req.headers?.['rsc'];
  const rsc = /[?&]_rsc=/.test(url) || rscHeader === '1';
  return routeShape(url) + (rsc ? ' (rsc)' : '');
}

export function createServerTiming(opts: { sink: TimingSink; health?: () => HostHealth; now?: () => number }) {
  const now = opts.now ?? (() => performance.now());
  const starts = new WeakMap<object, number>();
  let stats = new Map<string, Stat>();
  let slowLines = 0;
  let slowDropped = 0;
  let windowStart = now();

  function statFor(route: string, held: boolean): Stat {
    let s = stats.get(route);
    if (s) return s;
    const key = stats.size >= SERVER_TIMING_LIMITS.maxRoutes ? 'other' : route;
    s = stats.get(key);
    if (!s) stats.set(key, (s = { h: new Histogram(), s: {}, held }));
    return s;
  }

  return {
    start(req: object): void {
      starts.set(req, now());
    },

    finish(req: RequestLike & object, res: ResponseLike): void {
      const t0 = starts.get(req);
      if (t0 === undefined) return;
      starts.delete(req);
      const ms = now() - t0;
      const route = requestRoute(req);
      let type = '';
      try {
        type = String(res.getHeader?.('content-type') ?? '');
      } catch {
        // A response that cannot be asked: no type.
      }
      const held = HELD_ROUTE.test(route) || HELD_TYPE.test(type);
      const stat = statFor(route, held);
      stat.h.add(ms);
      const cls = `${Math.floor((res.statusCode ?? 0) / 100)}xx`;
      stat.s[cls] = (stat.s[cls] ?? 0) + 1;
      if (held || ms <= SERVER_TIMING_LIMITS.slowMs) return;
      if (slowLines >= SERVER_TIMING_LIMITS.slowLinesPerWindow) {
        slowDropped++;
        return;
      }
      slowLines++;
      let reqId: string | undefined;
      try {
        const v = res.getHeader?.('x-request-id');
        if (typeof v === 'string' && /^[a-z0-9-]{1,64}$/i.test(v)) reqId = v;
      } catch {
        // No id: the line still says which route.
      }
      // Its number in data, not the message, so one slow route groups as
      // one line. Kept out of the error groups of the daily digest: the
      // perf section reports slow routes.
      opts.sink.warn(
        'perf',
        `slow request ${req.method ?? 'GET'} ${route}`,
        { durationMs: Math.round(ms), status: res.statusCode, digest: false },
        undefined,
        { reqId, route },
      );
    },

    /** The window's routes and health, and a fresh window. */
    snapshot(): { windowMs: number; requests: number; routes: RouteStat[]; slow: number; health?: HostHealth } {
      const t = now();
      const routes = [...stats.entries()].map(([route, s]) => ({
        route,
        n: s.h.count,
        p50: Math.round(s.h.quantile(0.5)),
        p95: Math.round(s.h.quantile(0.95)),
        max: Math.round(s.h.max),
        s: s.s,
        total: s.h.sum,
        ...(s.held ? { held: true } : {}),
      }));
      routes.sort((a, b) => (a.held ? 1 : 0) - (b.held ? 1 : 0) || b.total - a.total);
      const out = {
        windowMs: Math.round(t - windowStart),
        requests: routes.reduce((n, r) => n + r.n, 0),
        routes: routes.slice(0, SERVER_TIMING_LIMITS.routesPerLine).map(({ total: _total, ...r }) => r),
        slow: slowLines + slowDropped,
        ...(opts.health ? { health: opts.health() } : {}),
      };
      stats = new Map();
      slowLines = 0;
      slowDropped = 0;
      windowStart = t;
      return out;
    },

    /** Writes the window's perf line. */
    flush(): void {
      const snap = this.snapshot();
      opts.sink.info('perf', 'server timing', snap);
    },
  };
}

export type ServerTiming = ReturnType<typeof createServerTiming>;

const MB = 1024 * 1024;

/** Host health from what the process already has: the event loop delay
 *  monitor, the load average, its own memory, and the download and Python
 *  lanes (read through their process-wide globals, so nothing heavy is
 *  imported here). */
export function makeHealth(loop: { percentile(p: number): number; max: number; reset(): void } | null, os: { loadavg(): number[] }) {
  return (): HostHealth => {
    const mem = process.memoryUsage();
    const out: HostHealth = {
      load: os.loadavg().map((n) => Math.round(n * 100) / 100),
      rssMb: Math.round(mem.rss / MB),
      heapMb: Math.round(mem.heapUsed / MB),
    };
    if (loop) {
      out.loopP50 = Math.round(loop.percentile(50) / 1e6);
      out.loopP99 = Math.round(loop.percentile(99) / 1e6);
      out.loopMax = Math.round(loop.max / 1e6);
      loop.reset();
    }
    const g = globalThis as Record<symbol, unknown>;
    const gate = g[Symbol.for('ember.downloadGate')] as { inFlightCount?: () => number; waitingCount?: () => number } | undefined;
    if (gate?.inFlightCount) {
      out.downloads = gate.inFlightCount();
      out.downloadsWaiting = gate.waitingCount?.() ?? 0;
    }
    const lanes = g[Symbol.for('ember.pythonLanes')] as Record<string, { active: number; waiting: number }> | undefined;
    if (lanes) {
      out.python = Object.values(lanes).reduce((n, l) => n + l.active, 0);
      out.pythonWaiting = Object.values(lanes).reduce((n, l) => n + l.waiting, 0);
    }
    return out;
  };
}

/** Starts timing every request of this server process. Returns the timing
 *  and its stop. instrumentation-node.ts calls it once, unless
 *  EMBER_PERF_LOG=off. */
export async function registerServerTiming(sink: TimingSink): Promise<{ timing: ServerTiming; stop: () => void }> {
  const dc = await import('node:diagnostics_channel');
  const { monitorEventLoopDelay } = await import('node:perf_hooks');
  const os = await import('node:os');
  let loop: ReturnType<typeof monitorEventLoopDelay> | null = null;
  try {
    loop = monitorEventLoopDelay({ resolution: 20 });
    loop.enable();
  } catch {
    loop = null;
  }
  const timing = createServerTiming({ sink, health: makeHealth(loop, os) });
  const onStart = (m: unknown) => {
    const req = (m as { request?: object }).request;
    if (req) timing.start(req);
  };
  const onFinish = (m: unknown) => {
    const { request, response } = m as { request?: RequestLike & object; response?: ResponseLike };
    if (request && response) timing.finish(request, response);
  };
  dc.subscribe('http.server.request.start', onStart);
  dc.subscribe('http.server.response.finish', onFinish);
  const timer = setInterval(() => {
    try {
      timing.flush();
    } catch {
      // Timing must never take the server down.
    }
  }, SERVER_TIMING_LIMITS.windowMs);
  timer.unref?.();
  const stop = () => {
    clearInterval(timer);
    dc.unsubscribe('http.server.request.start', onStart);
    dc.unsubscribe('http.server.response.finish', onFinish);
    loop?.disable();
  };
  return { timing, stop };
}
