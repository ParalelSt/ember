import type { NextRequest } from 'next/server';
import { featured } from '@/lib/sources/jamendo';
import { searchTracks as youtubeSearch } from '@/lib/sources/youtube';
import { fromError } from '@/lib/upsertTrack';
import { limitCaller, PUBLIC_PYTHON_LIMITS } from '@/lib/rateLimit';
import { createClient } from '@/lib/pocketbase/server';
import { searchUploads } from '@/lib/uploads';
import type { Track } from '@/types/track';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { getTrendingChart } from '@/lib/trending';
import { listUnavailableIds } from '@/lib/trackAvailability';

/** Uploads for the signed-in caller. Uses the cookie-bound client, so
 *  PocketBase's own list rule decides visibility — a signed-out caller gets
 *  nothing rather than us hand-rolling the check. Never throws: uploads are
 *  a bonus on top of search, not a reason to fail it. */
async function searchUploadsSafely(q: string): Promise<Track[]> {
  try {
    const pb = await createClient();
    if (!pb.authStore.isValid) return [];
    return await searchUploads(pb, q);
  } catch {
    return [];
  }
}

export const GET = withRequestLog('search', async (request: NextRequest) => {
  try {
    const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
    if (!q) {
      // The empty state is the "Trending" list: today's YouTube Music chart
      // in rank order, the same cached list as Home's shelf. Jamendo's
      // popular tracks only fill in while no chart has ever loaded. Not
      // throttled: it is cached and fires on load.
      try {
        const [chart, dead] = await Promise.all([getTrendingChart(), listUnavailableIds()]);
        const tracks = chart.tracks.filter((t) => !dead.has(t.id)).slice(0, 30);
        if (tracks.length > 0) return Response.json({ tracks });
      } catch {
        // fall through to Jamendo
      }
      try {
        const tracks = await featured({ limit: 30 });
        return Response.json({ tracks });
      } catch {
        return Response.json({ tracks: [] });
      }
    }
    // Caps actual searches (typed or voice — voice just fills the box). Humans
    // never hit this thanks to the 250ms debounce + React Query cache.
    const limited = await limitCaller(request, 'search', PUBLIC_PYTHON_LIMITS.search);
    if (limited) return limited;

    // Songs members uploaded to this server rank above YouTube: they're
    // deliberately here, and often they're the reason someone searched.
    const [uploads, tracks] = await Promise.all([
      searchUploadsSafely(q),
      youtubeSearch(q, { limit: 30 }),
    ]);
    return Response.json({ tracks: [...uploads, ...tracks] });
  } catch (e) {
    return fromError(e);
  }
});
