import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { mapTrackRow, type TrackRecord } from '@/lib/mapTrack';
import type { Track } from '@/types/track';
import { fromError, jsonError, upsertCatalogTrack } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';

export const GET = withRequestLog('likes', async () => {
  try {
    const { pb, user } = await requireUser();
    const records = await pb.collection('likes').getFullList({
      // liked_at is what a transfer sets, so imported songs sort into the
      // list where they belong (ensure_likes_fields.pb.js); `created` is the
      // tie-break and covers a row written before the backfill ran.
      filter: `user = "${user.id}"`,
      sort: '-liked_at,-created',
      expand: 'track',
    });
    const tracks = records
      .map((r) => mapTrackRow(((r.expand?.track as unknown) ?? null) as TrackRecord | null))
      .filter(Boolean);
    return Response.json({ tracks });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});

export const POST = withRequestLog('likes', async (request: NextRequest) => {
  try {
    const { pb, user } = await requireUser();
    const body = (await request.json().catch(() => null)) as { track?: Track } | null;
    const track = body?.track;
    if (!track?.id) return jsonError('track required', 400);

    const trackRecordId = await upsertCatalogTrack(track);

    try {
      await pb.collection('likes').create({
        user: user.id,
        track: trackRecordId,
        liked_at: new Date().toISOString(),
        origin: 'user',
      });
    } catch (e) {
      // Unique (user, track) — already liked. Treat as idempotent.
      const status = (e as { status?: number } | undefined)?.status;
      if (status !== 400) throw e;
    }
    return Response.json({ ok: true }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
