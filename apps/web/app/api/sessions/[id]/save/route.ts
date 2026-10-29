import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { loadSession, assertMember, sessionsClient } from '@/lib/sessions';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** The same cap as every other playlist name (app/api/playlists). */
const MAX_NAME_LEN = 200;

/** Copy the session queue into a normal playlist owned by the caller,
 *  anyone in the session can keep the roadtrip mix. */
export const POST = withRequestLog('sessions/[id]/save', async (request: NextRequest, ctx: RouteContext<'/api/sessions/[id]/save'>) => {
  try {
    const { pb, user } = await requireUser();
    const server = await sessionsClient();
    const { id } = await ctx.params;
    const session = await loadSession(server, id);
    await assertMember(server, session, user.id);
    const body = (await request.json().catch(() => null)) as { name?: string } | null;
    const asked = String(body?.name ?? '').trim();
    if (asked.length > MAX_NAME_LEN) return jsonError(`name must be at most ${MAX_NAME_LEN} characters`, 400);
    // A carlist from before its name was capped still saves.
    const name = asked || String(session.name).slice(0, MAX_NAME_LEN);

    const items = await server.collection('session_tracks').getFullList({
      filter: `session = "${session.id}"`,
      sort: 'position',
    });
    const playlist = await pb.collection('playlists').create({ user: user.id, name });
    let position = 1;
    for (const item of items) {
      try {
        await pb.collection('playlist_tracks').create({
          playlist: playlist.id,
          track: item.track,
          position: position++,
        });
      } catch {
        // duplicate track in the session (unique index), skip
      }
    }
    return Response.json({ playlist: { id: playlist.id, name } }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
