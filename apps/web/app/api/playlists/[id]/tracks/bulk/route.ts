import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { mapTrackRow, type TrackRecord } from '@/lib/mapTrack';
import { isUniqueHit, mapLimit, outcomeOf, racedSkip, readBulkTracks } from '@/lib/bulkCopy';
import { planCopy } from '@/lib/playlistCopy';
import { fromError, jsonError, upsertCatalogTrack } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import type { Track } from '@/types/track';
import { notFound, playlistAccess } from '@/lib/playlistAccess';

/** Copy songs into one of the member's playlists (their own, or a
 *  collaborative one they were added to). Body `{ tracks: Track[] }`
 *  (1 to 500). The server decides what is a duplicate: it reads the
 *  playlist's rows and runs lib/playlistCopy's `planCopy` itself, so a stale
 *  page, a second tab or a race can never add a song twice. Answers
 *  `{ added, skipped }`. */
export const POST = withRequestLog(
  'playlists/[id]/tracks/bulk',
  async (request: NextRequest, ctx: RouteContext<'/api/playlists/[id]/tracks/bulk'>) => {
    try {
      const { pb, user } = await requireUser();
      const { id } = await ctx.params;
      const parsed = readBulkTracks(await request.json().catch(() => null));
      if ('error' in parsed) return jsonError(parsed.error, 400);

      // The owner or a member (lib/playlistAccess.ts); "not yours" and
      // "doesn't exist" get the same answer (as the single add does).
      const access = await playlistAccess(pb, user.id, id);
      if (!access) return notFound();
      const { db } = access;

      const rows = await db.collection('playlist_tracks').getFullList({
        filter: `playlist = "${id}"`,
        // Two members adding at once can share a position: `created` breaks
      // the tie the same way the move route does.
      sort: 'position,created',
        expand: 'track',
      });
      const there = rows
        .map((r) => mapTrackRow(((r.expand?.track as unknown) ?? null) as TrackRecord | null))
        .filter((t): t is Track => !!t);
      // Start after the highest position, and at 1: PocketBase's required
      // number rejects 0.
      const start = rows.reduce((max, r) => Math.max(max, Number(r.position) || 0), 0) + 1;

      // The writes below run 4 at a time, and the SDK would cancel a request
      // that repeats one still in flight (same method and path): off for
      // this request's own client.
      db.autoCancellation(false);
      const plan = planCopy(parsed.tracks, there);
      const results = await mapLimit(plan.add, 4, async (track, i) => {
        const trackRecordId = await upsertCatalogTrack(track);
        try {
          await db
            .collection('playlist_tracks')
            .create({ playlist: id, track: trackRecordId, position: start + i, added_by: user.id });
          return null;
        } catch (e) {
          // The unique (playlist, track) index is the last fence: someone
          // added it between the read above and this write.
          if (!isUniqueHit(e)) throw e;
          return racedSkip(track);
        }
      });
      const raced = results.filter((r) => r !== null);
      return Response.json(outcomeOf(parsed.tracks, plan, raced), { status: 201 });
    } catch (e) {
      if (e instanceof UnauthorizedError) return unauthorizedResponse();
      return fromError(e);
    }
  },
);
