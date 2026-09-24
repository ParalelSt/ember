import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { mapTrackRow, type TrackRecord } from '@/lib/mapTrack';
import { isUniqueHit, mapLimit, outcomeOf, racedSkip, readBulkTracks } from '@/lib/bulkCopy';
import { planCopy } from '@/lib/playlistCopy';
import { fromError, jsonError, upsertTrack } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import type { Track } from '@/types/track';

/** Copy songs into one of the member's playlists. Body `{ tracks: Track[] }`
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

      // The cookie-scoped client only reads the caller's own playlists, and
      // the owner is checked again here, so "not yours" and "doesn't exist"
      // get the same answer (as the single add does).
      let owner: unknown;
      try {
        owner = (await pb.collection('playlists').getOne(id)).user;
      } catch {
        owner = null;
      }
      if (owner !== user.id) return jsonError('That playlist doesn’t exist, or isn’t yours', 404);

      const rows = await pb.collection('playlist_tracks').getFullList({
        filter: `playlist = "${id}"`,
        sort: 'position',
        expand: 'track',
      });
      const there = rows
        .map((r) => mapTrackRow(((r.expand?.track as unknown) ?? null) as TrackRecord | null))
        .filter((t): t is Track => !!t);
      // Start after the highest position, and at 1: PocketBase's required
      // number rejects 0.
      const start = rows.reduce((max, r) => Math.max(max, Number(r.position) || 0), 0) + 1;

      const plan = planCopy(parsed.tracks, there);
      const results = await mapLimit(plan.add, 4, async (track, i) => {
        const trackRecordId = await upsertTrack(pb, track);
        try {
          await pb.collection('playlist_tracks').create({ playlist: id, track: trackRecordId, position: start + i });
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
