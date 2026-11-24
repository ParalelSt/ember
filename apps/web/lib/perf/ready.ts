import { routeShape } from './route';

/** Which page requests count toward "content ready" (docs/android-performance.md,
 *  section 3): the app's own data calls, in flight. Streams, the held
 *  device-control poll and the perf and log uploads are meant to last or run
 *  on their own, so they never hold a page up. */
const IGNORED_API = /\/stream(\/|$)|\/remote\/|\/perf-log|\/logs?(\/|$)|\/events(\/|$)|\/apk|\/asset\//;

interface ApiCall {
  route: string;
  start: number;
  end?: number;
}

/** Tracks the page's same-origin /api/ fetches (the ones a page waits on
 *  for its data): which are in flight and which ended last. Only route
 *  shapes are kept, never a query or an id. */
export class ApiWatch {
  private open = new Map<number, ApiCall>();
  private done: ApiCall[] = [];
  private seq = 0;

  constructor(private now: () => number) {}

  /** Starts counting a request to `url`; call the returned function when it
   *  settles. null for a request that does not count. */
  begin(url: string, origin: string): (() => void) | null {
    let path: string;
    try {
      const u = new URL(url, origin);
      if (u.origin !== origin || !u.pathname.startsWith('/api/')) return null;
      path = u.pathname;
    } catch {
      return null;
    }
    if (IGNORED_API.test(path)) return null;
    const id = ++this.seq;
    const call: ApiCall = { route: routeShape(path), start: this.now() };
    if (this.open.size < 100) this.open.set(id, call);
    return () => {
      if (!this.open.delete(id)) return;
      call.end = this.now();
      this.done.push(call);
      if (this.done.length > 30) this.done.shift();
    };
  }

  /** Requests started at or after `after` that are still in flight. */
  openSince(after: number): number {
    let n = 0;
    for (const c of this.open.values()) if (c.start >= after) n++;
    return n;
  }

  /** The route of the request that ended last among those started at or
   *  after `after`. */
  lastEnded(after: number): string | undefined {
    let best: ApiCall | undefined;
    for (const c of this.done) if (c.start >= after && (!best || (c.end ?? 0) >= (best.end ?? 0))) best = c;
    return best?.route;
  }

  /** Wraps `win.fetch` so every request is counted. Returns the undo, which
   *  puts the old fetch back only if ours is still the one installed. */
  install(win: Window & typeof globalThis): () => void {
    const orig = win.fetch;
    if (typeof orig !== 'function') return () => {};
    const watch = this;
    const ours = function (this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      let end: (() => void) | null = null;
      try {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        end = watch.begin(url, win.location.origin);
      } catch {
        // Counting must never break a request.
      }
      const p = orig.call(win, input, init);
      if (end) p.then(end, end);
      return p;
    };
    win.fetch = ours as typeof win.fetch;
    return () => {
      if (win.fetch === (ours as typeof win.fetch)) win.fetch = orig;
    };
  }
}
