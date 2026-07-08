import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { mapTrackRow, type TrackRecord } from '@/lib/mapTrack';
import { fromError } from '@/lib/upsertTrack';

/** How far back a play still counts as "listening now". */
const WINDOW_MS = 30 * 60 * 1000;

/** What other members are listening to: each OTHER user's most recent play
 *  within the window. Admin client — the `plays` collection is per-user for
 *  normal reads; this is the one deliberate cross-user surface (invite-only
 *  friends server; a privacy opt-out can come later if anyone minds). */
export async function GET() {
  try {
    const { user } = await requireUser();
    const pb = await createAdminClient();
    const since = new Date(Date.now() - WINDOW_MS).toISOString().replace('T', ' ');
    const records = await pb.collection('plays').getList(1, 100, {
      filter: `played_at >= "${since}" && user != "${user.id}"`,
      sort: '-played_at',
      expand: 'track,user',
    });

    const seenUsers = new Set<string>();
    const items = [];
    for (const r of records.items) {
      const userId = String(r.user);
      if (seenUsers.has(userId)) continue; // newest play per user only
      seenUsers.add(userId);
      const track = mapTrackRow(((r.expand?.track as unknown) ?? null) as TrackRecord | null);
      if (!track) continue;
      const who = (r.expand?.user ?? null) as { name?: string; email?: string } | null;
      items.push({
        userName: String(who?.name || who?.email?.split('@')[0] || 'someone'),
        playedAt: String(r.played_at),
        track,
      });
      if (items.length >= 12) break;
    }
    return Response.json({ items });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
