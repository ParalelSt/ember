import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';
import { mapTrackRow, type TrackRecord } from '@/lib/mapTrack';
import { loadSession, assertMember, displayNames, sessionsClient } from '@/lib/sessions';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** The 2s poll: full session state (session meta + queue with track data). */
export const GET = withRequestLog('sessions/[id]', async (_req: NextRequest, ctx: RouteContext<'/api/sessions/[id]'>) => {
  try {
    const { user } = await requireUser();
    const pb = await sessionsClient();
    const { id } = await ctx.params;
    const session = await loadSession(pb, id);
    await assertMember(pb, session, user.id);

    const items = await pb.collection('session_tracks').getFullList({
      filter: `session = "${session.id}"`,
      sort: 'position',
      expand: 'track',
    });
    const names = await displayNames(pb, [String(session.host ?? ''), ...items.map((i) => String(i.added_by ?? ''))]);

    const queue = items
      .map((i) => {
        const track = mapTrackRow(((i.expand?.track as unknown) ?? null) as TrackRecord | null);
        if (!track) return null;
        return {
          id: i.id,
          position: Number(i.position ?? 0),
          played: i.played === true,
          addedByName: names.get(String(i.added_by ?? '')) ?? 'someone',
          track,
        };
      })
      .filter(Boolean);

    return Response.json({
      session: {
        id: session.id,
        code: String(session.code),
        name: String(session.name),
        active: session.active === true,
        nowIndex: Number(session.now_index ?? 0),
        hostName: names.get(String(session.host ?? '')) ?? 'host',
        isHost: session.host === user.id,
      },
      queue,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
