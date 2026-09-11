import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError, upsertTrack } from '@/lib/upsertTrack';
import { mapTrackRow, type TrackRecord } from '@/lib/mapTrack';
import type { Track } from '@/types/track';

export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/playlists/[id]/tracks/[trackId]/replace'>,
) {
  try {
    const { pb } = await requireUser();
    const { id, trackId } = await ctx.params;
    const body = (await request.json().catch(() => null)) as { track?: Track } | null;
    const replacement = body?.track;
    if (!replacement?.id) return jsonError('track required', 400);
    if (replacement.id === trackId) return jsonError('that is the same track', 400);

    try {
      await pb.collection('playlists').getOne(id);
    } catch {
      return jsonError('That playlist doesn’t exist, or isn’t yours', 404);
    }

    const oldRec = await pb.collection('tracks').getFirstListItem(`external_id = "${esc(trackId)}"`);
    const junction = await pb
      .collection('playlist_tracks')
      .getFirstListItem(`playlist = "${esc(id)}" && track = "${oldRec.id}"`);
    const newRecId = await upsertTrack(pb, replacement);

    // Already in the playlist: keep that copy where it sits and drop the dead
    // row, so a replace never creates a duplicate.
    let merged = false;
    try {
      await pb.collection('playlist_tracks').getFirstListItem(`playlist = "${esc(id)}" && track = "${newRecId}"`);
      merged = true;
    } catch {
      /* absent: swap in place */
    }
    if (merged) await pb.collection('playlist_tracks').delete(junction.id);
    else await pb.collection('playlist_tracks').update(junction.id, { track: newRecId });

    const row = await pb.collection('tracks').getOne(newRecId);
    return Response.json({ ok: true, merged, track: mapTrackRow(row as unknown as TrackRecord) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
