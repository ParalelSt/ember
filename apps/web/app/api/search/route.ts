import type { NextRequest } from 'next/server';
import { featured } from '@/lib/sources/jamendo';
import { searchTrackParts, searchTracks as youtubeSearch } from '@/lib/sources/youtube';
import { fromError } from '@/lib/upsertTrack';
import { limitCaller, PUBLIC_PYTHON_LIMITS } from '@/lib/rateLimit';
import { createClient } from '@/lib/pocketbase/server';
import { searchUploads } from '@/lib/uploads';
import type { Track } from '@/types/track';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { getTrendingChart } from '@/lib/trending';
import { listUnavailableIds } from '@/lib/trackAvailability';
import { MAX_SEARCH_QUERY_LEN as MAX_QUERY_LEN } from '@/lib/searchLimits';
import type { SearchChunk } from '@/lib/search/types';

/** Uploads for the signed-in caller. Uses the cookie-bound client, so
 *  PocketBase's own list rule decides visibility, a signed-out caller gets
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

/** The streamed answer (`?stream=1`): one JSON line per group, in the
 *  order the list shows them, each sent the moment it is ready:
 *  uploads (fast, PocketBase), then artists and songs together (the
 *  Artists section's place depends on the songs), then videos, then done.
 *  YouTube failing becomes an `error` line; the client says "search isn't
 *  working" only when nothing at all came back, as the one-shot answer
 *  did. The helper keeps running if the listener moves on, so its answer
 *  still lands in the search cache. */
function streamSearch(q: string): Response {
  const encoder = new TextEncoder();
  const youtube = searchTrackParts(q, { limit: 30 });
  // Asked here, inside the request, where the session cookie is readable.
  const uploads = searchUploadsSafely(q);
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: SearchChunk) => {
        if (!cancelled) controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
      };
      let failure: unknown = null;
      const settle = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
        try {
          return await p;
        } catch (e) {
          failure ??= e;
          return fallback;
        }
      };

      send({ type: 'uploads', tracks: await uploads });
      const [artists, songs] = await Promise.all([settle(youtube.artists, []), settle(youtube.songs, [])]);
      send({ type: 'artists', artists });
      send({ type: 'songs', tracks: songs });
      send({ type: 'videos', tracks: await settle(youtube.videos, []) });
      if (failure) {
        const e = failure as { status?: number; message?: string };
        send({ type: 'error', status: e.status ?? 502, error: e.message ?? 'Search failed' });
      }
      send({ type: 'done' });
      if (!cancelled) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      // no-transform: compression must not hold lines back to fill a block.
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
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
    if (q.length > MAX_QUERY_LEN) {
      return Response.json({ error: `Search is limited to ${MAX_QUERY_LEN} characters` }, { status: 400 });
    }
    // Caps actual searches (typed or voice, voice just fills the box). Humans
    // never hit this thanks to the 250ms debounce + React Query cache.
    const limited = await limitCaller(request, 'search', PUBLIC_PYTHON_LIMITS.search);
    if (limited) return limited;

    // The search UI asks for the streamed answer; anything else (an older
    // app, the track picker) still gets the one list below.
    if (request.nextUrl.searchParams.get('stream') === '1') return streamSearch(q);

    // Songs members uploaded to this server rank above YouTube: they're
    // deliberately here, and often they're the reason someone searched.
    const [uploads, youtube] = await Promise.all([
      searchUploadsSafely(q),
      youtubeSearch(q, { limit: 30 }).then(
        (tracks) => ({ tracks, error: null }),
        (error: unknown) => ({ tracks: [] as Track[], error }),
      ),
    ]);
    // A YouTube outage is an error (bughunt S03), but only when there is
    // nothing else to show: uploads that match still come back, so a member's
    // own songs never vanish from search because YouTube is unreachable.
    if (youtube.error && uploads.length === 0) throw youtube.error;
    return Response.json({ tracks: [...uploads, ...youtube.tracks] });
  } catch (e) {
    return fromError(e);
  }
});
