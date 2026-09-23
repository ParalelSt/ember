import 'server-only';
import { limitCaller, type RateLimitConfig } from '@/lib/rateLimit';

/** The `?prefetch=1` marker the auto cache puts on stream URLs (web fetch,
 *  Android CacheWriter, desktop reqwest), so the host can treat those
 *  requests as low priority. The contract lives in docs/prefetch.md. */

/** 10 prefetches a minute per listener. A skip-happy listener triggers at
 *  most two per track change, so this is headroom, and it caps what serving
 *  cached files to one listener's cache can cost. */
export const PREFETCH_LIMIT: RateLimitConfig = { windowMs: 60_000, max: 10 };

/** Seconds a busy host asks a prefetch to wait. */
export const BUSY_RETRY_AFTER_SEC = 30;

/** Added to every file served to a prefetch: the copy belongs in the
 *  listener's own cache, never in a shared proxy. */
export const PREFETCH_HEADERS: Record<string, string> = { 'Cache-Control': 'private, no-store' };

export function isPrefetchRequest(request: Request): boolean {
  try {
    return new URL(request.url).searchParams.get('prefetch') === '1';
  } catch {
    return false;
  }
}

/** 429 + Retry-After when this listener is over the prefetch limit, else
 *  null. Keyed like every public limit (lib/rateLimit's callerKey): the
 *  PocketBase-verified user id, else the client IP, which is what native
 *  players present. A made-up pb_auth cookie no longer buys a fresh bucket
 *  (bughunt S04). Counts only prefetch requests, so it can never refuse a
 *  normal play. */
export function prefetchLimitResponse(request: Request): Promise<Response | null> {
  return limitCaller(request, 'prefetch', PREFETCH_LIMIT);
}

/** The answer to a prefetch that would have had to start a cold download
 *  while the host was busy. */
export function busyResponse(retryAfter: number = BUSY_RETRY_AFTER_SEC): Response {
  return Response.json(
    { error: 'Host is busy, try again shortly.', cause: 'busy' },
    { status: 503, headers: { 'Retry-After': String(retryAfter) } },
  );
}
