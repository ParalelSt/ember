import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';
import { mapTrackRow, type TrackRecord } from '@/lib/mapTrack';
import { loadSession } from '@/lib/sessions';

/** The 2s poll: full session state (session meta + queue with track data). */
export async function GET(_req: NextRequest, ctx: RouteContext<'/api/sessions/[id]'>) {
  try {
    const { pb, user } = await requireUser();
    const { id } = await ctx.params;
    const session = await loadSession(pb, id);

    const items = await pb.collection('session_tracks').getFullList({
      filter: `session = "${session.id}"`,
      sort: 'position',
      expand: 'track,added_by',
    });

    const queue = items
      .map((i) => {
        const track = mapTrackRow(((i.expand?.track as unknown) ?? null) as TrackRecord | null);
        if (!track) return null;
        const addedBy = (i.expand?.added_by ?? null) as { name?: string; email?: string } | null;
        return {
          id: i.id,
          position: Number(i.position ?? 0),
          played: i.played === true,
          addedByName: String(addedBy?.name || addedBy?.email || 'someone'),
          track,
        };
      })
      .filter(Boolean);

    const host = (session.expand?.host ?? null) as { name?: string; email?: string } | null;
    return Response.json({
      session: {
        id: session.id,
        code: String(session.code),
        name: String(session.name),
        active: session.active === true,
        nowIndex: Number(session.now_index ?? 0),
        hostName: String(host?.name || host?.email || 'host'),
        isHost: session.host === user.id,
      },
      queue,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
