import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError, upsertTrack } from '@/lib/upsertTrack';
import { loadSession, assertActive } from '@/lib/sessions';
import type { Track } from '@/types/track';

/** Append a track to the live queue (any member — everyone's a DJ). */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/sessions/[id]/tracks'>) {
  try {
    const { pb, user } = await requireUser();
    const { id } = await ctx.params;
    const session = await loadSession(pb, id);
    assertActive(session);

    const body = (await request.json().catch(() => null)) as { track?: Track } | null;
    const track = body?.track;
    if (!track?.id) return jsonError('track required', 400);

    const trackRecordId = await upsertTrack(pb, track);

    let nextPosition = 1;
    try {
      const last = await pb
        .collection('session_tracks')
        .getFirstListItem(`session = "${session.id}"`, { sort: '-position' });
      nextPosition = (Number(last.position) || 0) + 1;
    } catch {
      // empty queue — keep 1
    }

    await pb.collection('session_tracks').create({
      session: session.id,
      track: trackRecordId,
      position: nextPosition,
      added_by: user.id,
      played: false,
    });
    return Response.json({ ok: true }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
