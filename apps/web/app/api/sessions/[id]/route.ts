import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';
import { mapTrackRow, type TrackRecord } from '@/lib/mapTrack';
import { loadSession, assertMember, sessionsClient, carlistPerson, msSince } from '@/lib/sessions';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import type { PlaylistPerson } from '@/types/track';

/** The 2s poll: full session state (session meta, who is in, and the queue
 *  with track data). People show by the name they chose, never by email. */
export const GET = withRequestLog('sessions/[id]', async (_req: NextRequest, ctx: RouteContext<'/api/sessions/[id]'>) => {
  try {
    const { user } = await requireUser();
    const pb = await sessionsClient();
    const { id } = await ctx.params;
    const session = await loadSession(pb, id);
    await assertMember(pb, session, user.id);

    const [items, memberRows] = await Promise.all([
      pb.collection('session_tracks').getFullList({
        filter: pb.filter('session = {:s}', { s: session.id }),
        sort: 'position',
        expand: 'track,added_by',
      }),
      pb
        .collection('session_members')
        .getFullList({ filter: pb.filter('session = {:s}', { s: session.id }), sort: 'created', expand: 'user' })
        .catch(() => []),
    ]);

    const queue = items
      .map((i) => {
        const track = mapTrackRow(((i.expand?.track as unknown) ?? null) as TrackRecord | null);
        if (!track) return null;
        const addedBy = i.expand?.added_by ? carlistPerson(i.expand.added_by, String(i.added_by)) : null;
        return {
          id: i.id,
          position: Number(i.position ?? 0),
          played: i.played === true,
          addedByName: addedBy?.name ?? carlistPerson(null).name,
          addedBy,
          track,
        };
      })
      .filter(Boolean);

    const host = carlistPerson(session.expand?.host ?? null, String(session.host));
    const members: PlaylistPerson[] = [host];
    for (const row of memberRows) {
      const person = carlistPerson(row.expand?.user ?? null, String(row.user));
      if (person.id && person.id !== host.id) members.push(person);
    }

    return Response.json({
      session: {
        id: session.id,
        code: String(session.code),
        name: String(session.name),
        active: session.active === true,
        nowIndex: Number(session.now_index ?? 0),
        hostName: host.name,
        hostId: host.id,
        isHost: session.host === user.id,
        viewerId: user.id,
        nowElapsedMs: msSince(session.updated),
      },
      members,
      queue,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
