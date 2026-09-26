import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { newSessionCode, addMember, sessionsClient } from '@/lib/sessions';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { playlistAccess } from '@/lib/playlistAccess';

/** Start a carlist session. Optionally seeds the queue from one of the
 *  caller's playlists. Returns {session:{id, code, name}}. */
export const POST = withRequestLog('sessions', async (request: NextRequest) => {
  try {
    const { pb, user } = await requireUser();
    const server = await sessionsClient();
    const body = (await request.json().catch(() => null)) as
      | { name?: string; seedPlaylistId?: string }
      | null;
    const name = String(body?.name ?? '').trim() || 'Carlist';

    // Unique code — retry a few times on the (rare) unique-index collision.
    let session = null;
    for (let attempt = 0; attempt < 5 && !session; attempt++) {
      try {
        session = await server.collection('sessions').create({
          code: newSessionCode(),
          name,
          host: user.id,
          active: true,
          now_index: 0,
        });
      } catch (e) {
        if (attempt === 4) throw e;
      }
    }
    if (!session) return jsonError('Could not create the session — try again.', 500);

    await addMember(server, session.id, user.id);

    if (body?.seedPlaylistId) {
      const seedId = body.seedPlaylistId.replace(/[^a-zA-Z0-9]/g, '');
      // Seeding reads a playlist's tracks, so it has to be one you can open
      // (yours, or a collaborative one you are a member of), otherwise a
      // session id doubles as a peek into someone else's library.
      const access = await playlistAccess(pb, user.id, seedId);
      if (!access) {
        return jsonError("That playlist doesn't exist, or isn't yours.", 404);
      }
      const items = await access.db.collection('playlist_tracks').getFullList({
        filter: `playlist = "${seedId}"`,
        sort: 'position',
      });
      let position = 1;
      for (const item of items) {
        await server.collection('session_tracks').create({
          session: session.id,
          track: item.track,
          position: position++,
          added_by: user.id,
          played: false,
        });
      }
    }

    return Response.json(
      { session: { id: session.id, code: String(session.code), name: String(session.name) } },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
