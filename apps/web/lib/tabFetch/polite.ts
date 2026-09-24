/** Asking a tab site politely (docs/tabs-v3.md section 1): one queue per
 *  site for the whole server, a gap between requests, a browser
 *  User-Agent, and a long pause when the site says slow down.
 *
 *   - One request at a time per site, at least `gapMs` after the previous
 *     one started (2 s by default).
 *   - 429 (too many requests), 403 (refused) or 503 (busy): the site is left
 *     alone for `backoffMs` (an hour by default). Every request in that
 *     time fails at once with `SiteBackoffError`, nothing is sent.
 *   - Any other failure is the caller's to handle; it does not back off.
 *
 *  Pure apart from the injected `fetch`, clock and sleep, so the unit tests
 *  drive it without waiting. */

/** What a desktop browser sends. The pages are the ones a browser gets;
 *  a bot User-Agent is served a block page. */
export const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

export const DEFAULT_GAP_MS = 2000;
export const DEFAULT_BACKOFF_MS = 60 * 60 * 1000;
const BACKOFF_STATUS = new Set([403, 429, 503]);

export class SiteBackoffError extends Error {
  constructor(
    readonly site: string,
    readonly until: number,
    readonly status: number | null,
  ) {
    super(`${site} asked Ember to slow down; not asking again until ${new Date(until).toISOString()}`);
    this.name = 'SiteBackoffError';
  }
}

export class FetchStatusError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} from ${url}`);
    this.name = 'FetchStatusError';
  }
}

export interface PoliteOptions {
  gapMs?: number;
  backoffMs?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class PoliteFetcher {
  private readonly gapMs: number;
  private readonly backoffMs: number;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Per site: when the last request started, the tail of its queue, and
   *  until when it is left alone. */
  private readonly last = new Map<string, number>();
  private readonly tail = new Map<string, Promise<unknown>>();
  private readonly blocked = new Map<string, { until: number; status: number | null }>();
  /** Requests actually sent, per site (for the logs and the tests). */
  readonly sent = new Map<string, number>();

  constructor(opts: PoliteOptions = {}) {
    this.gapMs = opts.gapMs ?? DEFAULT_GAP_MS;
    this.backoffMs = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.fetchFn = opts.fetch ?? ((...args) => fetch(...args));
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Until when the site is left alone, or null. */
  backoffUntil(site: string): number | null {
    const b = this.blocked.get(site);
    if (!b) return null;
    if (b.until <= this.now()) {
      this.blocked.delete(site);
      return null;
    }
    return b.until;
  }

  /** Leave the site alone for the backoff time (a block page with a 200,
   *  seen by the caller, counts too). */
  backOff(site: string, status: number | null): void {
    this.blocked.set(site, { until: this.now() + this.backoffMs, status });
  }

  /** GET a page as text, queued behind every other request to the site.
   *  `accept` lists error statuses whose body is still the page wanted (a
   *  site that serves "no results" as a 404). */
  getText(site: string, url: string, opts: { accept?: number[] } = {}): Promise<string> {
    const run = async () => {
      const until = this.backoffUntil(site);
      if (until) throw new SiteBackoffError(site, until, this.blocked.get(site)?.status ?? null);
      const wait = (this.last.get(site) ?? -Infinity) + this.gapMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.last.set(site, this.now());
      this.sent.set(site, (this.sent.get(site) ?? 0) + 1);
      const res = await this.fetchFn(url, {
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        cache: 'no-store',
        redirect: 'follow',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (BACKOFF_STATUS.has(res.status)) {
        this.backOff(site, res.status);
        throw new SiteBackoffError(site, this.now() + this.backoffMs, res.status);
      }
      if (!res.ok && !opts.accept?.includes(res.status)) throw new FetchStatusError(res.status, url);
      return res.text();
    };
    const prev = this.tail.get(site) ?? Promise.resolve();
    const next = prev.then(run, run);
    // The queue keeps going whatever this request does.
    this.tail.set(
      site,
      next.catch(() => undefined),
    );
    return next;
  }

  /** For tests: forget the queue, the gaps and any backoff. */
  reset(): void {
    this.last.clear();
    this.tail.clear();
    this.blocked.clear();
    this.sent.clear();
  }
}
