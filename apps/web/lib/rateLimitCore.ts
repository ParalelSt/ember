// The in-memory limiter itself, with no server-only imports, so proxy.ts
// (which Next bundles on its own) can use it too. lib/rateLimit.ts re-exports
// all of it and adds the session-aware caller key.

interface Bucket {
  /** Timestamps (ms) of recent allowed hits, newest last. */
  hits: number[];
  /** The window this key is checked with, so the sweep knows when it's stale. */
  windowMs: number;
}

const buckets = new Map<string, Bucket>();

/** Every key ever seen used to stay in the map for good (bughunt S04). Now
 *  a sweep at most once a minute drops buckets whose newest hit has left
 *  their window: such a bucket would allow the next hit anyway. */
const SWEEP_EVERY_MS = 60_000;
let lastSweep = 0;

function sweep(now: number) {
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    const newest = b.hits[b.hits.length - 1];
    if (newest === undefined || newest <= now - b.windowMs) buckets.delete(key);
  }
}

export interface RateLimitConfig {
  /** Window in ms. Hits older than this are forgotten. */
  windowMs: number;
  /** Maximum allowed hits inside the window. */
  max: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds the caller should wait before retrying (0 if ok). */
  retryAfter: number;
  /** Hits remaining in the current window after this check. */
  remaining: number;
}

/** In-memory per-key rate limiter. Loses state on server restart, which is
 *  fine for what it guards: floods, not a determined attacker with many IPs
 *  (the Python helper cap in lib/sources/youtube.ts is the backstop there).
 *
 *  `consume: false` reads the bucket without recording a hit, for routes
 *  that must reject an already-over-limit caller up front but only charge
 *  the quota once the guarded work succeeds (see recordRateLimitHit).
 *  Defaults to true so existing callers are unchanged. */
export function checkRateLimit(
  key: string,
  cfg: RateLimitConfig,
  opts: { consume?: boolean } = {},
): RateLimitResult {
  const consume = opts.consume ?? true;
  const now = Date.now();
  sweep(now);
  const cutoff = now - cfg.windowMs;
  const bucket = buckets.get(key) ?? { hits: [], windowMs: cfg.windowMs };
  bucket.windowMs = cfg.windowMs;
  // Prune old hits.
  bucket.hits = bucket.hits.filter((t) => t > cutoff);

  if (bucket.hits.length >= cfg.max) {
    const oldest = bucket.hits[0];
    const retryAfter = Math.ceil(((oldest ?? now) + cfg.windowMs - now) / 1000);
    buckets.set(key, bucket);
    return { ok: false, retryAfter: Math.max(1, retryAfter), remaining: 0 };
  }

  if (consume) bucket.hits.push(now);
  buckets.set(key, bucket);
  return { ok: true, retryAfter: 0, remaining: cfg.max - bucket.hits.length };
}

/** Records a hit without checking the limit first, for a caller that
 *  already confirmed (checkRateLimit/rateLimitResponse with consume:false)
 *  it is under the cap and now charges it because the work succeeded. */
export function recordRateLimitHit(key: string, cfg: RateLimitConfig): void {
  const now = Date.now();
  const cutoff = now - cfg.windowMs;
  const bucket = buckets.get(key) ?? { hits: [], windowMs: cfg.windowMs };
  bucket.windowMs = cfg.windowMs;
  bucket.hits = bucket.hits.filter((t) => t > cutoff);
  bucket.hits.push(now);
  buckets.set(key, bucket);
}

/** The caller's IP address: the LAST X-Forwarded-For entry.
 *
 *  Next 16 gives route handlers no socket address. What it does do (see
 *  next/dist/server/base-server.js) is fill X-Forwarded-For with the socket's
 *  remote address when the request has none. The public way in is Tailscale
 *  Funnel (`tailscale funnel 3000`), whose proxy replaces any X-Forwarded-For
 *  the client sent with the one address it saw. Proxies that append instead
 *  (nginx, Caddy) put the address they saw last. Either way the last entry is
 *  the one a proxy wrote, while earlier entries are whatever the caller typed.
 *  Someone connecting straight to :3000 on the LAN or tailnet can still
 *  choose it; that is the trusted side, and the helper cap still holds.
 *  X-Real-IP is ignored: nothing in front of Ember sets it. */
export function clientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for') ?? '';
  const parts = fwd.split(',').map((p) => p.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? 'unknown';
}

/** Tests only. */
export function _bucketCount(): number {
  return buckets.size;
}

/** Tests only. */
export function _resetBuckets(): void {
  buckets.clear();
  lastSweep = 0;
}
