import type { NextRequest } from 'next/server';
import type PocketBase from 'pocketbase';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { serverLogger } from '@/lib/logger/server';
import { collabClient, sharedWith } from '@/lib/playlistAccess';
import { canonicalId } from '@/lib/trackIdentity';

const MAX_TRACK_ID_LEN = 300;

/** `?track=<track id>`: which of your playlists (your own, and the
 *  collaborative ones shared with you) already have this song, as
 *  `{ playlistIds }`. The Add to playlist menu marks them, so nobody adds a
 *  song twice by mistake. A song the server has never seen is in none. */
export const GET = withRequestLog('playlists/containing', async (request: NextRequest) => {
  try {
    const { pb, user } = await requireUser();
    const raw = request.nextUrl.searchParams.get('track')?.trim() ?? '';
    if (!raw || raw.length > MAX_TRACK_ID_LEN) return jsonError('track required', 400);

    // The catalog row(s) for this id, in either spelling (lib/trackIdentity).
    const spellings = [...new Set([raw, canonicalId(raw)])];
    const rows = await pb.collection('tracks').getFullList({
      filter: anyOf(pb, 'external_id', spellings),
      fields: 'id',
    });
    if (rows.length === 0) return Response.json({ playlistIds: [] });
    const recordIds = rows.map((r) => r.id);

    // Your own: PocketBase's rule only shows your session the rows of your
    // own playlists.
    const own = await pb.collection('playlist_tracks').getFullList({
      filter: anyOf(pb, 'track', recordIds),
      fields: 'playlist',
    });
    const ids = new Set(own.map((r) => String(r.playlist)));

    // Shared with you: through the server's client, only for playlists you
    // are a member of. A server that cannot sign in still answers for yours.
    try {
      const admin = await collabClient();
      const shared = new Set((await sharedWith(admin, user.id)).map((p) => p.id));
      if (shared.size > 0) {
        const there = await admin.collection('playlist_tracks').getFullList({
          filter: anyOf(admin, 'track', recordIds),
          fields: 'playlist',
        });
        for (const r of there) if (shared.has(String(r.playlist))) ids.add(String(r.playlist));
      }
    } catch (e) {
      serverLogger.error('api', 'shared playlists lookup failed', { userId: user.id }, e instanceof Error ? e : undefined);
    }
    return Response.json({ playlistIds: [...ids] });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});

/** `field = a || field = b`, with every value bound as a parameter. */
function anyOf(pb: PocketBase, field: string, values: string[]): string {
  const params: Record<string, string> = {};
  const clauses = values.map((v, i) => {
    params[`v${i}`] = v;
    return `${field} = {:v${i}}`;
  });
  return pb.filter(clauses.join(' || '), params);
}
