import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import type { Track } from '@/types/track';
import { fromError, jsonError, upsertTrack } from '@/lib/upsertTrack';

export async function POST(request: NextRequest, ctx: RouteContext<'/api/playlists/[id]/tracks'>) {
  try {
    const { pb } = await requireUser();
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as { track?: Track } | null;
    const track = body?.track;
    if (!track?.id) return jsonError('track required', 400);

    const trackRecordId = await upsertTrack(pb, track);

    // Append at the next position. Pull the highest existing position via a
    // single-record query for cheapness. Start at 1 — PocketBase's required
    // validator on number fields rejects 0 as "missing".
    let nextPosition = 1;
    try {
      const last = await pb
        .collection('playlist_tracks')
        .getFirstListItem(`playlist = "${id}"`, { sort: '-position' });
      nextPosition = (Number(last.position) || 0) + 1;
    } catch {
      // empty playlist — keep 1
    }

    await pb.collection('playlist_tracks').create({
      playlist: id,
      track: trackRecordId,
      position: nextPosition,
    });
    return Response.json({ ok: true }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
