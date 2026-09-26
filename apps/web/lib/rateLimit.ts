import 'server-only';
import { verifiedUserId } from '@/lib/auth';
import { checkRateLimit, clientIp, type RateLimitConfig } from '@/lib/rateLimitCore';

export {
  checkRateLimit,
  clientIp,
  recordRateLimitHit,
  _bucketCount,
  _resetBuckets,
} from '@/lib/rateLimitCore';
export type { RateLimitConfig, RateLimitResult } from '@/lib/rateLimitCore';


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

/** Limits for the public routes that start a Python helper (bughunt S04).
 *  Generous: a person browsing, even quickly, stays far below them. Fetching
 *  a song that is not on disk is members only, with its own per-member
 *  budget: lib/downloadAccess. */
export const PUBLIC_PYTHON_LIMITS = {
  /** Typed searches; the search box debounces 250 ms. */
  search: { windowMs: 60_000, max: 40 },
  /** Album, artist and shared-track pages. */
  browse: { windowMs: 60_000, max: 60 },
  /** "More like this" from a seed song. */
  recommended: { windowMs: 60_000, max: 30 },
} satisfies Record<string, RateLimitConfig>;

/** rateLimitResponse keyed on callerKey, for public routes. */
export async function limitCaller(request: Request, scope: string, cfg: RateLimitConfig): Promise<Response | null> {
  return rateLimitResponse(`${scope}:${await callerKey(request)}`, cfg);
}

