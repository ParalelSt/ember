import 'server-only';
import { requireUser, UnauthorizedError, unauthorizedResponse, type AuthedUser } from '@/lib/auth';
import { rateLimitResponse, type RateLimitConfig } from '@/lib/rateLimit';
import { fromError } from '@/lib/upsertTrack';
import type { RadioStation } from '@/lib/radio/station';
import type PocketBase from 'pocketbase';

/** What the radio routes share: members only, each with a budget. A person
 *  browsing stations, even quickly, stays far below these. */
export const RADIO_LIMITS = {
  /** The lists (nearby, country, search, one station, favourites). */
  browse: { windowMs: 60_000, max: 60 },
  /** Streams opened; switching stations fast is a few a minute. */
  stream: { windowMs: 60_000, max: 30 },
  /** Station logos: a page of shelves asks for one per station shown (up
   *  to a few hundred), and the browser keeps them for a week after. */
  logo: { windowMs: 60_000, max: 600 },
} satisfies Record<string, RateLimitConfig>;

/** Runs `fn` for a signed-in member within the `scope` budget; a 401 for
 *  anyone else, a 429 over the budget, the usual error answers otherwise. */
export async function forMember(
  scope: keyof typeof RADIO_LIMITS,
  fn: (ctx: { pb: PocketBase; user: AuthedUser }) => Promise<Response>,
): Promise<Response> {
  try {
    const ctx = await requireUser();
    const limited = rateLimitResponse(`radio-${scope}:${ctx.user.id}`, RADIO_LIMITS[scope]);
    if (limited) return limited;
    return await fn(ctx);
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}

/** A list answer. Private: it is per member (signed in), and the server
 *  keeps its own cache. */
export function stationsResponse(stations: RadioStation[]): Response {
  return Response.json({ stations }, { headers: { 'Cache-Control': 'private, max-age=300' } });
}
