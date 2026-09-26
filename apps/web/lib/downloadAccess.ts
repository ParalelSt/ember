import 'server-only';
import { verifiedUserId } from '@/lib/auth';
import { checkRateLimit, recordRateLimitHit, rateLimitResponse, type RateLimitConfig } from '@/lib/rateLimit';

/** Who may make the host fetch a song it does not have yet (security audit
 *  2026-09-25, M2). Every such fetch is a yt-dlp run with the host's YouTube
 *  cookies, bandwidth and disk, so it takes a signed-in member, and each
 *  member has a budget. Songs already on disk stay public: the shared /track
 *  page plays them for friends who are not signed in. */

/** New fetches per member. A listener, even skipping fast, starts one per
 *  song they have never played; an offline download of a playlist starts
 *  one per missing song, a few seconds apart. */
export const NEW_FETCH_LIMITS = {
  minute: { windowMs: 60_000, max: 60 },
  hour: { windowMs: 60 * 60_000, max: 600 },
} satisfies Record<string, RateLimitConfig>;

/** The verified member behind this request, or null (signed out, a token
 *  PocketBase refuses, or PocketBase unreachable). */
export function signedInMember(): Promise<string | null> {
  return verifiedUserId();
}

/** 401 for a caller who would start a new fetch without signing in. */
export function signInToFetchResponse(): Response {
  return Response.json(
    { error: 'Sign in to play songs that are not on this server yet.', cause: 'sign-in' },
    { status: 401 },
  );
}

/** 429 when this member is over either window, else null (and the fetch is
 *  counted in both). The hour is only charged once the minute allows it. */
export function newFetchLimitResponse(userId: string): Response | null {
  const hourKey = `new-fetch:h:${userId}`;
  if (!checkRateLimit(hourKey, NEW_FETCH_LIMITS.hour, { consume: false }).ok) {
    return rateLimitResponse(hourKey, NEW_FETCH_LIMITS.hour, { consume: false });
  }
  const minute = rateLimitResponse(`new-fetch:m:${userId}`, NEW_FETCH_LIMITS.minute);
  if (minute) return minute;
  recordRateLimitHit(hourKey, NEW_FETCH_LIMITS.hour);
  return null;
}
