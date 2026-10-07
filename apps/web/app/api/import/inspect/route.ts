import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { rateLimitResponse } from '@/lib/rateLimit';
import { parseImportUrl } from '@/lib/import/url';
import { inspectLink } from '@/lib/import/inspect';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { createAdminClient } from '@/lib/pocketbase/server';
import { isAlreadyLiked } from '@/lib/import/alreadyLiked';
import { likedIndexFor } from '@/lib/import/likedSongs';
import { SAMPLE_SIZE } from '@/lib/import/sources/index';
import type { InspectResult } from '@/lib/import/types';

/** Inspect a pasted playlist link (lib/import/url.ts lists what is accepted)
 *  for the create-playlist dialog's preview. YT Music returns ready Ember
 *  tracks; Spotify returns its source items (the first 100, read from the
 *  public embed page). Nothing is matched here: that is the import job's
 *  work (POST /api/import/jobs).
 *
 *  With `liked: true` (the Transfer page, going into the likes) it also
 *  says which of the playlist's songs the person has already liked, for the
 *  preview's chips: `{ liked: { count, sample, newSample } }`. */
export const POST = withRequestLog('import/inspect', async (request: NextRequest) => {
  try {
    const { user } = await requireUser();
    // Each look-up reads a playlist from Spotify or YouTube: keep it modest.
    const limited = rateLimitResponse(`import:${user.id}`, { windowMs: 600_000, max: 5 });
    if (limited) return limited;

    const body = (await request.json().catch(() => null)) as { url?: unknown; liked?: unknown } | null;
    const parsed = typeof body?.url === 'string' ? parseImportUrl(body.url.slice(0, 500)) : null;
    if (!parsed) {
      return jsonError('Paste a Spotify or YouTube Music playlist link.', 400);
    }
    const result = await inspectLink(user.id, parsed);
    if (body?.liked !== true) return Response.json(result);
    const index = await likedIndexFor(await createAdminClient(), user.id);
    const songs = linkSongs(result);
    const already = songs.filter((s) => isAlreadyLiked(s, index));
    const known = new Set(already);
    const name = (s: { title: string; artist: string }) => ({ title: s.title, artist: s.artist });
    return Response.json({
      ...result,
      liked: {
        count: already.length,
        sample: already.slice(0, SAMPLE_SIZE).map(name),
        newSample: songs.filter((s) => !known.has(s)).slice(0, SAMPLE_SIZE).map(name),
      },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});

/** A playlist's songs by name, whichever service it came from. */
function linkSongs(r: InspectResult): { title: string; artist: string; artists?: string[]; videoId?: string | null }[] {
  return r.source === 'spotify'
    ? r.items.map((i) => ({ title: i.title, artist: i.artist, artists: i.artists }))
    : r.tracks.map((t) => ({ title: t.title, artist: t.artist, videoId: t.sourceId }));
}
