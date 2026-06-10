import type { NextRequest } from 'next/server';
import { getTrack } from '@/lib/sources/youtube';
import { createAdminClient } from '@/lib/pocketbase/server';
import { mapTrackRow, type TrackRecord } from '@/lib/mapTrack';
import { fromError, jsonError } from '@/lib/upsertTrack';

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Track metadata for the shareable /track/<videoId> page. Two tiers:
 *  PocketBase first (proper music metadata for anything a member has
 *  played / liked / playlisted), ytmusicapi get_song as the fallback for
 *  ids the app has never seen. Auth-gated via proxy.ts like every
 *  non-public route — sharing stays members-only. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ videoId: string }> }) {
  try {
    const { videoId } = await ctx.params;
    if (!VIDEO_ID_RE.test(videoId)) return jsonError('invalid videoId', 400);

    const pb = await createAdminClient();
    try {
      const row = await pb
        .collection('tracks')
        .getFirstListItem(`external_id = "youtube:${videoId}"`);
      const track = mapTrackRow(row as unknown as TrackRecord);
      if (track) {
        // Old rows can have an empty stream_url — always serve a usable one.
        if (!track.streamUrl) track.streamUrl = `/api/youtube/stream/${videoId}`;
        return Response.json({ track });
      }
    } catch {
      // Not in PB — fall through to ytmusicapi.
    }

    const track = await getTrack(videoId);
    if (!track) return jsonError('track not found', 404);
    return Response.json({ track });
  } catch (e) {
    return fromError(e);
  }
}
