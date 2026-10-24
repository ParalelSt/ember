import type PocketBase from 'pocketbase';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { serverLogger } from '@/lib/logger/server';
import { collabClient, sharedWith } from '@/lib/playlistAccess';

/** Counted this many playlists at a time, so a big library does not open a
 *  request per playlist all at once. */
const BATCH = 8;

/** How many songs each of your playlists holds, yours and the collaborative
 *  ones shared with you: `{ counts: { [playlistId]: n } }`. Only the head
 *  unit's covers sidebar asks (components/nav/Sidebar), so the library's
 *  own list (GET /api/playlists, polled everywhere) stays as cheap as it
 *  was. A shared playlist that cannot be counted is left out. */
export const GET = withRequestLog('playlists/counts', async () => {
  try {
    const { pb, user } = await requireUser();
    const own = await pb.collection('playlists').getFullList({
      filter: pb.filter('user = {:u}', { u: user.id }),
      fields: 'id',
    });
    const jobs: [PocketBase, string][] = own.map((r) => [pb, r.id]);
    try {
      const admin = await collabClient();
      for (const p of await sharedWith(admin, user.id)) jobs.push([admin, p.id]);
    } catch (e) {
      serverLogger.error('api', 'shared playlist counts failed', { userId: user.id }, e instanceof Error ? e : undefined);
    }

    const counts: Record<string, number> = {};
    for (let i = 0; i < jobs.length; i += BATCH) {
      await Promise.all(
        jobs.slice(i, i + BATCH).map(async ([db, id]) => {
          const page = await db.collection('playlist_tracks').getList(1, 1, {
            filter: db.filter('playlist = {:p}', { p: id }),
            fields: 'id',
          });
          counts[id] = page.totalItems;
        }),
      );
    }
    return Response.json({ counts });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
