import 'server-only';

interface Bucket {
  /** Timestamps (ms) of recent allowed hits, newest last. */
  hits: number[];
}

const buckets = new Map<string, Bucket>();

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
 *  fine for the protections it covers (the rules are advisory throttles
 *  against accidental spam, not a security boundary).
 *
 *  `consume: false` reads the bucket without recording a hit — for routes
 *  that need to reject an already-over-limit caller up front but must not
 *  charge the quota until the work the limit guards actually succeeds (see
 *  recordRateLimitHit). Defaults to true so existing callers are unchanged. */
export function checkRateLimit(
  key: string,
  cfg: RateLimitConfig,
  opts: { consume?: boolean } = {},
): RateLimitResult {
  const consume = opts.consume ?? true;
  const now = Date.now();
  const cutoff = now - cfg.windowMs;
  const bucket = buckets.get(key) ?? { hits: [] };
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

/** Records a hit without checking the limit first — for a caller that
 *  already confirmed (via checkRateLimit/rateLimitResponse with
 *  consume:false) that it's under the cap, and now wants to charge it only
 *  because the guarded work actually succeeded. */
export function recordRateLimitHit(key: string, cfg: RateLimitConfig): void {
  const now = Date.now();
  const cutoff = now - cfg.windowMs;
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => t > cutoff);
  bucket.hits.push(now);
  buckets.set(key, bucket);
}

/** Bounded per-caller key for PUBLIC routes that have no requireUser (e.g.
 *  search). Prefers the pb_auth cookie (per-user), falls back to the client IP.
 *  The cookie is hashed to keep the map key small; exactness doesn't matter —
 *  these are advisory throttles, not auth. */
export function keyFromRequest(request: Request): string {
  const cookie = request.headers.get('cookie') ?? '';
  const m = /(?:^|;\s*)pb_auth=([^;]+)/.exec(cookie);
  if (m) {
    // djb2 hash → short stable-per-cookie key.
    let h = 5381;
    for (let i = 0; i < m[1].length; i++) h = ((h << 5) + h + m[1].charCodeAt(i)) | 0;
    return `pb:${(h >>> 0).toString(36)}`;
  }
  const fwd = request.headers.get('x-forwarded-for');
  const ip = fwd?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'anon';
  return `ip:${ip}`;
}

/** Convenience helper for routes — returns a Response if the caller is over
 *  the limit, otherwise null so the handler continues. */
export function rateLimitResponse(
  key: string,
  cfg: RateLimitConfig,
  opts: { consume?: boolean } = {},
): Response | null {
  const r = checkRateLimit(key, cfg, opts);
  if (r.ok) return null;
  return Response.json(
    { error: `Slow down — try again in about ${r.retryAfter}s.` },
    {
      status: 429,
      headers: { 'Retry-After': String(r.retryAfter) },
    },
  );
}
