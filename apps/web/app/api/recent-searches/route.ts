import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { mapTrackRow, type TrackRecord } from '@/lib/mapTrack';
import { fromError, jsonError, upsertTrack } from '@/lib/upsertTrack';
import type { Track } from '@/types/track';

const MAX_RECENT = 10;

/** The tracks this user played from search, newest first. Server-side so the
 *  list is the same on every device. */
export async function GET() {
  try {
    const { pb, user } = await requireUser();
    const rows = await pb.collection('recent_searches').getList(1, MAX_RECENT, {
      filter: `user = "${user.id}"`,
      sort: '-played_at',
      expand: 'track',
    });
    const tracks = rows.items
      .map((r) => mapTrackRow(((r.expand?.track as unknown) ?? null) as TrackRecord | null))
      .filter(Boolean);
    return Response.json({ tracks });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}

/** Record a play-from-search. Bumps the timestamp when the track is already
 *  in the list (unique index on user+track), then trims to MAX_RECENT. */
export async function POST(request: NextRequest) {
  try {
    const { pb, user } = await requireUser();
    const body = (await request.json().catch(() => null)) as { track?: Track } | null;
    const track = body?.track;
    if (!track?.id) return jsonError('track required', 400);

    const trackRecordId = await upsertTrack(pb, track);
    const playedAt = new Date().toISOString();

    try {
      const existing = await pb
        .collection('recent_searches')
        .getFirstListItem(`user = "${user.id}" && track = "${trackRecordId}"`);
      await pb.collection('recent_searches').update(existing.id, { played_at: playedAt });
    } catch {
      await pb.collection('recent_searches').create({
        user: user.id,
        track: trackRecordId,
        played_at: playedAt,
      });
    }

    // Trim anything past the cap (oldest first).
    const all = await pb.collection('recent_searches').getFullList({
      filter: `user = "${user.id}"`,
      sort: '-played_at',
    });
    for (const stale of all.slice(MAX_RECENT)) {
      await pb.collection('recent_searches').delete(stale.id);
    }

    return Response.json({ ok: true }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
