import 'server-only';
import { verifiedUserId } from '@/lib/auth';

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
 *  (the Python helper cap in lib/sources/youtube.ts is the backstop there). */
export function checkRateLimit(key: string, cfg: RateLimitConfig): RateLimitResult {
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

  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { ok: true, retryAfter: 0, remaining: cfg.max - bucket.hits.length };
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

/** Per-caller key: the user id when PocketBase confirms the session, else
 *  the client IP. The cookie alone is never trusted: a made-up pb_auth used
 *  to buy a fresh bucket with every request (bughunt S04). */
export async function callerKey(request: Request): Promise<string> {
  const cookie = request.headers.get('cookie') ?? '';
  if (/(?:^|;\s*)pb_auth=/.test(cookie)) {
    const id = await verifiedUserId();
    if (id) return `user:${id}`;
  }
  return `ip:${clientIp(request)}`;
}

/** Convenience helper for routes — returns a Response if the caller is over
 *  the limit, otherwise null so the handler continues. */
export function rateLimitResponse(key: string, cfg: RateLimitConfig): Response | null {
  const r = checkRateLimit(key, cfg);
  if (r.ok) return null;
  return Response.json(
    { error: `Slow down — try again in about ${r.retryAfter}s.` },
    {
      status: 429,
      headers: { 'Retry-After': String(r.retryAfter) },
    },
  );
}

/** Limits for the public routes that start a Python helper (bughunt S04).
 *  Generous: a person browsing, even quickly, stays far below them. */
export const PUBLIC_PYTHON_LIMITS = {
  /** Typed searches; the search box debounces 250 ms. */
  search: { windowMs: 60_000, max: 40 },
  /** Album, artist and shared-track pages. */
  browse: { windowMs: 60_000, max: 60 },
  /** "More like this" from a seed song. */
  recommended: { windowMs: 60_000, max: 30 },
  /** Songs not on disk yet, each a yt-dlp download. */
  streamFetch: { windowMs: 60_000, max: 60 },
} satisfies Record<string, RateLimitConfig>;

/** rateLimitResponse keyed on callerKey, for public routes. */
export async function limitCaller(request: Request, scope: string, cfg: RateLimitConfig): Promise<Response | null> {
  return rateLimitResponse(`${scope}:${await callerKey(request)}`, cfg);
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
