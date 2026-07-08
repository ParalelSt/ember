import type { NextRequest } from 'next/server';
import { featured } from '@/lib/sources/jamendo';
import { searchTracks as youtubeSearch } from '@/lib/sources/youtube';
import { fromError } from '@/lib/upsertTrack';
import { keyFromRequest, rateLimitResponse } from '@/lib/rateLimit';

export async function GET(request: NextRequest) {
  try {
    const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
    if (!q) {
      // Trending (empty query) isn't throttled — it's cheap and fires on load.
      try {
        const tracks = await featured({ limit: 30 });
        return Response.json({ tracks });
      } catch {
        return Response.json({ tracks: [] });
      }
    }
    // Caps actual searches (typed or voice — voice just fills the box). Humans
    // never hit this thanks to the 250ms debounce + React Query cache.
    const limited = rateLimitResponse(`search:${keyFromRequest(request)}`, { windowMs: 60_000, max: 40 });
    if (limited) return limited;

    const tracks = await youtubeSearch(q, { limit: 30 });
    return Response.json({ tracks });
  } catch (e) {
    return fromError(e);
  }
}
