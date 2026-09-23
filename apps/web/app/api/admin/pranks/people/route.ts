import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { fileUrl } from '@/lib/pocketbase/fileUrl';
import { mapTrackRow, type TrackRecord } from '@/lib/mapTrack';
import { rateLimitResponse } from '@/lib/rateLimit';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { personName, presenceLine } from '@/lib/pranks/copy';
import { parsePbDate, pbDate } from '@/lib/pranks/limits';
import { presenceStore } from '@/lib/pranks/presence';
import { prankErrorResponse } from '@/lib/pranks/server';
import type { PrankPerson } from '@/lib/pranks/types';

/** How far back a play still says "was playing". */
const PLAY_WINDOW_MS = 30 * 60 * 1000;

/** Everybody, with what they are playing in plain words: the heartbeat when
 *  there is one, else their newest play in the last 30 min. Pranking someone
 *  implies seeing what they play, so share_listening does not apply here. */
export const GET = withRequestLog('admin/pranks/people', async () => {
  try {
    const { user } = await requireAdmin();
    const limited = rateLimitResponse(`prank-people:${user.id}`, { windowMs: 60_000, max: 60 });
    if (limited) return limited;

    const pb = await createAdminClient();
    const now = Date.now();
    const [users, plays] = await Promise.all([
      pb.collection('users').getFullList({ sort: 'name' }),
      pb.collection('plays').getList(1, 200, {
        filter: pb.filter('played_at >= {:since}', { since: pbDate(now - PLAY_WINDOW_MS) }),
        sort: '-played_at',
        expand: 'track',
      }),
    ]);

    const lastPlay = new Map<string, { title: string; artist: string; playedAt: number }>();
    for (const p of plays.items) {
      const uid = String(p.user);
      if (lastPlay.has(uid)) continue;
      const track = mapTrackRow((p.expand?.track ?? null) as TrackRecord | null);
      if (track) lastPlay.set(uid, { title: track.title, artist: track.artist, playedAt: parsePbDate(p.played_at) });
    }

    const store = presenceStore();
    const people: PrankPerson[] = users.map((u) => {
      const fresh = store.get(u.id, now);
      return {
        id: u.id,
        name: personName(u),
        avatarUrl: u.avatar ? fileUrl(u, u.avatar as string) : null,
        isAdmin: u.is_admin === true,
        line: presenceLine(fresh, store.last(u.id), fresh ? null : (lastPlay.get(u.id) ?? null), now),
        listening: fresh?.isPlaying === true,
      };
    });
    // Whoever is listening right now first; the rest by name.
    people.sort((a, b) => Number(b.listening) - Number(a.listening) || a.name.localeCompare(b.name));
    return Response.json({ people });
  } catch (e) {
    return prankErrorResponse(e);
  }
});
