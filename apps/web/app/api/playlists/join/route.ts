import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { isInviteCode, MAX_MEMBERS } from '@/lib/collab';
import { addMember, collabClient } from '@/lib/playlistAccess';

const DEAD_LINK = 'This invite link doesn’t work anymore. Ask the owner for a new one.';

/** Open an invite link: `{ code }`. Whoever is signed in becomes a member
 *  of the collaborative playlist whose link it is, and gets its id back.
 *  A POST (the join page sends it), never a GET, so a link preview or a
 *  prefetch cannot add anyone. A link that is off, replaced or on a
 *  playlist that is no longer collaborative answers 404. */
export const POST = withRequestLog('playlists/join', async (request: NextRequest) => {
  try {
    const { user } = await requireUser();
    const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
    const code = body?.code;
    // Checked before any lookup: an empty code would match every playlist
    // whose link is off.
    if (!isInviteCode(code)) return jsonError(DEAD_LINK, 404);

    const admin = await collabClient();
    const found = await admin.collection('playlists').getList(1, 2, {
      filter: admin.filter('invite_code = {:code} && collaborative = true', { code }),
      fields: 'id,user',
    });
    if (found.items.length !== 1) return jsonError(DEAD_LINK, 404);
    const playlist = found.items[0];
    if (playlist.user === user.id) return Response.json({ playlistId: playlist.id, joined: false });

    const outcome = await addMember(admin, playlist.id, user.id);
    if (outcome === 'full') return jsonError(`This playlist is already shared with ${MAX_MEMBERS} people`, 409);
    if (outcome === 'added') {
      // The owner may have replaced or turned off the link (removing
      // someone does) while this join was in flight with the old one. Check
      // again now the row is in, and take it back out if the link is gone.
      const now = await admin.collection('playlists').getOne(playlist.id, { fields: 'id,invite_code,collaborative' });
      if (now.invite_code !== code || now.collaborative !== true) {
        const row = await admin
          .collection('playlist_members')
          .getFirstListItem(admin.filter('playlist = {:p} && user = {:u}', { p: playlist.id, u: user.id }))
          .catch((e: { status?: number }) => {
            if (e?.status === 404) return null;
            throw e;
          });
        if (row) await admin.collection('playlist_members').delete(row.id);
        return jsonError(DEAD_LINK, 404);
      }
    }
    return Response.json({ playlistId: playlist.id, joined: outcome === 'added' });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
