import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { mapTrackRow, type TrackRecord } from '@/lib/mapTrack';
import type { Track } from '@/types/track';
import { fromError, jsonError, upsertTrack } from '@/lib/upsertTrack';

export async function GET() {
  try {
    const { pb, user } = await requireUser();
    const records = await pb.collection('likes').getFullList({
      filter: `user = "${user.id}"`,
      sort: '-created',
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
}

export async function POST(request: NextRequest) {
  try {
    const { pb, user } = await requireUser();
    const body = (await request.json().catch(() => null)) as { track?: Track } | null;
    const track = body?.track;
    if (!track?.id) return jsonError('track required', 400);

    const trackRecordId = await upsertTrack(pb, track);

    try {
      await pb.collection('likes').create({ user: user.id, track: trackRecordId });
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
}
