import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError, upsertCatalogTrack } from '@/lib/upsertTrack';
import { loadSession, assertActive, assertMember, sessionsClient } from '@/lib/sessions';
import { parseAddPosition, planInsert } from '@/lib/carlist';
import type { Track } from '@/types/track';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** Add a track to the live queue (any member, everyone's a DJ).
 *  Body: { track, position?: 'next' | 'end' } (left out: 'end'). 'next'
 *  puts it right after the song playing now. Answers { ok, position, ahead }:
 *  ahead is how many songs play before it (-1: it is the first). */
export const POST = withRequestLog('sessions/[id]/tracks', async (request: NextRequest, ctx: RouteContext<'/api/sessions/[id]/tracks'>) => {
  try {
    const { user } = await requireUser();
    const pb = await sessionsClient();
    const { id } = await ctx.params;
    const session = await loadSession(pb, id);
    assertActive(session);
    await assertMember(pb, session, user.id);

    const body = (await request.json().catch(() => null)) as { track?: Track; position?: unknown } | null;
    const track = body?.track;
    if (!track?.id) return jsonError('track required', 400);
    const where = parseAddPosition(body?.position);
    if (!where) return jsonError("position must be 'next' or 'end'", 400);

    const trackRecordId = await upsertCatalogTrack(track);

    const rows = await pb.collection('session_tracks').getFullList({
      filter: pb.filter('session = {:s}', { s: session.id }),
      sort: 'position',
      fields: 'id,position',
    });
    const plan = planInsert(
      rows.map((r) => Number(r.position) || 0),
      Number(session.now_index ?? 0),
      where,
    );
    // Make room first (from the end, so no two rows ever share a position
    // on the way), then take the freed slot.
    for (const shift of [...plan.shifts].reverse()) {
      await pb.collection('session_tracks').update(rows[shift.index].id, { position: shift.position });
    }

    await pb.collection('session_tracks').create({
      session: session.id,
      track: trackRecordId,
      position: plan.position,
      added_by: user.id,
      played: false,
    });
    return Response.json({ ok: true, position: where, ahead: plan.ahead }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
