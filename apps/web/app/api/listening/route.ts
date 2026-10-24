import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createCatalogClient } from '@/lib/pocketbase/server';
import { mapTrackRow, type TrackRecord } from '@/lib/mapTrack';
import { fromError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { publicName } from '@/lib/collab';

/** How far back a play still counts as "listening now". */
const WINDOW_MS = 30 * 60 * 1000;
/** Plays are read newest first, a page at a time, until there are enough
 *  people. Every song start is a play, so one member skipping through songs
 *  can fill a page on their own. Bounded: at most PAGES * PER_PAGE plays. */
const PER_PAGE = 200;
const PAGES = 5;
const MAX_ITEMS = 12;

/** What other members are listening to: each OTHER user's most recent play
 *  within the window. Admin client, the `plays` collection is per-user for
 *  normal reads; this is the one deliberate cross-user surface.
 *
 *  Only members who opted in (`share_listening`) appear, filtered HERE,
 *  server-side. The UI
 *  declining to render them would not be privacy: the data would still be in
 *  the response for anyone reading the network tab. Their plays are still
 *  recorded, so recommendations and the 14-day cleanup are unaffected. */
export const GET = withRequestLog('listening', async () => {
  try {
    const { user } = await requireUser();
    // The reused admin login: Home asks every 30 s, and a fresh one is a
    // password check each time.
    const pb = await createCatalogClient();
    const since = new Date(Date.now() - WINDOW_MS).toISOString().replace('T', ' ');
    const seenUsers = new Set<string>();
    const items = [];
    for (let page = 1; page <= PAGES && items.length < MAX_ITEMS; page++) {
      const records = await pb.collection('plays').getList(page, PER_PAGE, {
        filter: `played_at >= "${since}" && user != "${user.id}"`,
        sort: '-played_at',
        expand: 'track,user',
        skipTotal: true,
      });

      for (const r of records.items) {
        const userId = String(r.user);
        if (seenUsers.has(userId)) continue; // newest play per user only
        seenUsers.add(userId);
        const who = (r.expand?.user ?? null) as
          | { name?: string; share_listening?: boolean }
          | null;
        // Opted out of being seen. `seenUsers` already has them, so their older
        // plays can't slip through further down the list either.
        if (who?.share_listening !== true) continue;

        const track = mapTrackRow(((r.expand?.track as unknown) ?? null) as TrackRecord | null);
        if (!track) continue;
        items.push({
          // A name, never the email: a member without one is "Unnamed member".
          userName: publicName(who),
          playedAt: String(r.played_at),
          track,
        });
        if (items.length >= MAX_ITEMS) break;
      }
      if (records.items.length < PER_PAGE) break;
    }
    return Response.json({ items });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
