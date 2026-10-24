import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { newSessionCode, addMember, sessionsClient, LIVE_WINDOW_MS } from '@/lib/sessions';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { playlistAccess, type PlaylistAccess } from '@/lib/playlistAccess';
import { rateLimitResponse } from '@/lib/rateLimit';

/** Per person. Starting one is a once-a-drive thing; this only stops a
 *  loop from filling the sessions collection. */
const CREATE_LIMIT = { windowMs: 60_000, max: 10 };
/** The start dialog's own cap (components/session/SessionDialogs.tsx). */
const MAX_CARLIST_NAME = 120;

/** Start a carlist session. Optionally seeds the queue from one of the
 *  caller's playlists. Returns {session:{id, code, name}}. */
export const POST = withRequestLog('sessions', async (request: NextRequest) => {
  try {
    const { pb, user } = await requireUser();
    const limited = rateLimitResponse(`session-create:${user.id}`, CREATE_LIMIT);
    if (limited) return limited;
    const server = await sessionsClient();
    const body = (await request.json().catch(() => null)) as
      | { name?: string; seedPlaylistId?: unknown }
      | null;
    const name = String(body?.name ?? '').trim() || 'Carlist';
    if (name.length > MAX_CARLIST_NAME) return jsonError(`name must be at most ${MAX_CARLIST_NAME} characters`, 400);

    // The seed playlist is checked BEFORE anything is created: a refusal
    // after the session row existed left a "live" carlist behind (shown by
    // the Carlist button for hours), and each retry made another.
    const rawSeed = body?.seedPlaylistId;
    if (rawSeed !== undefined && rawSeed !== null && typeof rawSeed !== 'string') {
      return jsonError('seedPlaylistId must be a string', 400);
    }
    let seed: { id: string; access: PlaylistAccess } | null = null;
    if (rawSeed) {
      const seedId = rawSeed.replace(/[^a-zA-Z0-9]/g, '');
      // Seeding reads a playlist's tracks, so it has to be one you can open
      // (yours, or a collaborative one you are a member of), otherwise a
      // session id doubles as a peek into someone else's library.
      const access = seedId ? await playlistAccess(pb, user.id, seedId) : null;
      if (!access) {
        return jsonError("That playlist doesn't exist, or isn't yours.", 404);
      }
      seed = { id: seedId, access };
    }

    // Unique code, retry a few times on the (rare) unique-index collision.
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
    if (!session) return jsonError('Could not create the session. Try again.', 500);

    try {
      await addMember(server, session.id, user.id);

      if (seed) {
        const items = await seed.access.db.collection('playlist_tracks').getFullList({
          filter: `playlist = "${seed.id}"`,
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
    } catch (e) {
      // Half made is no carlist: take it away again rather than leave a
      // live session with a partial queue behind.
      await server.collection('sessions').delete(session.id).catch(() => undefined);
      throw e;
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

/** The live carlist the caller hosts or joined, for the Carlist button in
 *  Your library: {carlist: {id, code, name, isHost} | null}. One that has
 *  not moved on in LIVE_WINDOW_MS no longer counts (hosts often just close
 *  the app instead of ending it). The one they host comes first: the host's
 *  device lets go of hosting (useReleaseStaleHosting) when this answers
 *  another carlist, so a host who had also joined a friend's carlist lost
 *  the role whenever the friend's moved on more recently. */
export const GET = withRequestLog('sessions', async () => {
  try {
    const { user } = await requireUser();
    const server = await sessionsClient();
    const since = new Date(Date.now() - LIVE_WINDOW_MS);
    const latest = async (who: string) =>
      (
        await server.collection('sessions').getList(1, 1, {
          filter: server.filter(`active = true && updated >= {:since} && ${who}`, { since, u: user.id }),
          sort: '-updated',
        })
      ).items[0];
    const row = (await latest('host = {:u}')) ?? (await latest('session_members_via_session.user ?= {:u}'));
    return Response.json({
      carlist: row
        ? { id: row.id, code: String(row.code), name: String(row.name), isHost: row.host === user.id }
        : null,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
