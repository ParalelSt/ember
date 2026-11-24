/** Where a request's time went on the host (docs/android-performance.md,
 *  section 5.4): auth (the session check and refresh), db (PocketBase) and
 *  upstream (YouTube and other outside hosts), plus the total. A request
 *  gets a `Phases` when it starts (lib/perf/serverTiming.ts); the global
 *  fetch is wrapped once so every call is added to the request that made
 *  it, found through an AsyncLocalStorage kept on globalThis (the proxy and
 *  the routes may be separate bundles). Overlapping calls count once: the
 *  time is the span at least one call of that kind was open. Nothing but
 *  durations is kept: no URL, header or body. No imports from node, so the
 *  proxy can use it. */

export type PhaseName = 'auth' | 'db' | 'upstream';

interface Clock {
  active: number;
  since: number;
  ms: number;
}

export interface Phases {
  now: () => number;
  auth: Clock;
  db: Clock;
  upstream: Clock;
}

export interface PhaseSnapshot {
  auth: number;
  db: number;
  upstream: number;
  /** Total minus the three, never below 0. */
  other: number;
  total: number;
}

/** What the request's phases are kept in: an AsyncLocalStorage. */
export interface PhaseStore {
  getStore(): Phases | undefined;
  enterWith(p: Phases): void;
}

const STORE_KEY = Symbol.for('ember.perfPhaseStore');
const FETCH_KEY = Symbol.for('ember.perfPhaseFetch');

const clock = (): Clock => ({ active: 0, since: 0, ms: 0 });

export function newPhases(now: () => number = () => performance.now()): Phases {
  return { now, auth: clock(), db: clock(), upstream: clock() };
}

/** Opens a span of `name`; call the result when it ends. */
export function phaseStart(p: Phases, name: PhaseName): () => void {
  const c = p[name];
  if (c.active++ === 0) c.since = p.now();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    if (--c.active === 0) c.ms += p.now() - c.since;
  };
}

/** Adds a span that already happened. */
export function addPhase(p: Phases, name: PhaseName, ms: number): void {
  if (Number.isFinite(ms) && ms > 0) p[name].ms += ms;
}

function spent(p: Phases, name: PhaseName): number {
  const c = p[name];
  return c.ms + (c.active > 0 ? p.now() - c.since : 0);
}

export function phaseSnapshot(p: Phases, totalMs: number): PhaseSnapshot {
  const auth = spent(p, 'auth');
  const db = spent(p, 'db');
  const upstream = spent(p, 'upstream');
  const r = Math.round;
  return { auth: r(auth), db: r(db), upstream: r(upstream), other: r(Math.max(0, totalMs - auth - db - upstream)), total: r(totalMs) };
}

/** The Server-Timing entries for a snapshot. Entries are only the names the
 *  page's resource timing reads back (lib/perf/core.ts keeps four). */
export function serverTimingEntries(s: PhaseSnapshot): string {
  return `auth;dur=${s.auth}, db;dur=${s.db}, upstream;dur=${s.upstream}, total;dur=${s.total}`;
}

const OWN_ENTRY = /^\s*(auth|db|upstream|total)\s*(;|$)/;

/** The `auth;dur=` the proxy wrote itself, when its fetch could not be
 *  counted (a bundle that runs apart from the host's global fetch). */
export function authFromHeader(header: string): number {
  const m = /(?:^|,)\s*auth;dur=([\d.]+)/.exec(header);
  return m ? Number(m[1]) : 0;
}

/** Drops our own entries from an existing Server-Timing value. */
export function withoutOwnEntries(header: string): string {
  return header
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e && !OWN_ENTRY.test(e))
    .join(', ');
}

export interface HeaderTarget {
  headersSent?: boolean;
  getHeader?(name: string): unknown;
  setHeader?(name: string, value: string): unknown;
  writeHead?: (...args: unknown[]) => unknown;
}

/** Makes the response carry its phases as Server-Timing when its head is
 *  written: replaces the proxy's lone `auth` entry with all four. */
export function attachServerTiming(res: HeaderTarget, p: Phases, t0: number): void {
  const orig = res.writeHead;
  if (typeof orig !== 'function' || typeof res.setHeader !== 'function') return;
  res.writeHead = function (this: unknown, ...args: unknown[]) {
    try {
      if (!res.headersSent) {
        const prev = String(res.getHeader?.('server-timing') ?? '');
        if (p.auth.ms === 0 && p.auth.active === 0) addPhase(p, 'auth', authFromHeader(prev));
        const own = serverTimingEntries(phaseSnapshot(p, p.now() - t0));
        const rest = withoutOwnEntries(prev);
        res.setHeader!('server-timing', rest ? `${rest}, ${own}` : own);
      }
    } catch {
      // Timing must never break a response.
    }
    return orig.apply(this, args);
  } as typeof res.writeHead;
}

// ── The request's phases, found from anywhere ───────────────────────────

export function installPhaseStore(store: PhaseStore): void {
  (globalThis as Record<symbol, unknown>)[STORE_KEY] = store;
}

export function phaseStore(): PhaseStore | undefined {
  return (globalThis as Record<symbol, unknown>)[STORE_KEY] as PhaseStore | undefined;
}

/** The running request's phases, if there is one. */
export function currentPhases(): Phases | undefined {
  try {
    return phaseStore()?.getStore();
  } catch {
    return undefined;
  }
}

/** Times `fn` as `name` for the running request (a no-op outside one). */
export async function timePhase<T>(name: PhaseName, fn: () => Promise<T>): Promise<T> {
  const p = currentPhases();
  const end = p ? phaseStart(p, name) : null;
  try {
    return await fn();
  } finally {
    end?.();
  }
}

// ── Which fetch is which phase ──────────────────────────────────────────

const PB_AUTH_PATH = /\/api\/(collections\/[^/]+\/(auth-with-password|auth-refresh|auth-with-oauth2)|admins\/auth-(with-password|refresh))\/?$/;
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])$/;

/** The phase a request to `url` belongs to: PocketBase is db (its sign-in
 *  and refresh paths are auth), another loopback host is the app itself
 *  (not counted), anything else is upstream. null for what is not counted. */
export function classifyFetch(url: string, pbOrigin: string): PhaseName | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.origin === pbOrigin) return PB_AUTH_PATH.test(u.pathname) ? 'auth' : 'db';
  if (LOOPBACK.test(u.hostname)) return null;
  return 'upstream';
}

export function pocketbaseOrigin(env: Record<string, string | undefined> = process.env): string {
  const raw = env.POCKETBASE_URL ?? env.NEXT_PUBLIC_POCKETBASE_URL ?? 'http://127.0.0.1:8090';
  try {
    return new URL(/^https?:\/\//.test(raw) ? raw : 'http://127.0.0.1:8090').origin;
  } catch {
    return 'http://127.0.0.1:8090';
  }
}

/** A fetch that adds each call's time to the running request's phases. Time
 *  runs until the response head arrives (or the call fails). */
export function timedFetch(orig: typeof fetch, pbOrigin: string, current: () => Phases | undefined = currentPhases): typeof fetch {
  return function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    let end: (() => void) | null = null;
    try {
      const p = current();
      if (p) {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const phase = classifyFetch(url, pbOrigin);
        if (phase) end = phaseStart(p, phase);
      }
    } catch {
      // Counting must never break a request.
    }
    const answer = orig.call(globalThis, input, init);
    if (end) answer.then(end, end);
    return answer;
  } as typeof fetch;
}

/** Wraps the global fetch, once per process. Returns the undo. */
export function installPhaseFetch(pbOrigin: string = pocketbaseOrigin()): () => void {
  const g = globalThis as Record<symbol, unknown>;
  if (g[FETCH_KEY]) return () => {};
  const orig = globalThis.fetch;
  if (typeof orig !== 'function') return () => {};
  const wrapped = timedFetch(orig, pbOrigin);
  g[FETCH_KEY] = wrapped;
  globalThis.fetch = wrapped;
  return () => {
    if (globalThis.fetch === wrapped) globalThis.fetch = orig;
    delete g[FETCH_KEY];
  };
}
