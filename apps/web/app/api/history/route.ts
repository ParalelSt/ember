import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { mapTrackRow, type TrackRecord } from '@/lib/mapTrack';
import type { Track } from '@/types/track';
import { fromError, jsonError, upsertTrack } from '@/lib/upsertTrack';

export async function GET() {
  try {
    const { pb, user } = await requireUser();
    const records = await pb.collection('plays').getList(1, 50, {
      filter: `user = "${user.id}"`,
      sort: '-played_at',
      expand: 'track',
    });
    const seen = new Set<string>();
    const tracks = [];
    for (const r of records.items) {
      const mapped = mapTrackRow(((r.expand?.track as unknown) ?? null) as TrackRecord | null);
      if (!mapped || seen.has(mapped.id)) continue;
      seen.add(mapped.id);
      tracks.push(mapped);
    }
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

    await pb.collection('plays').create({
      user: user.id,
      track: trackRecordId,
      played_at: new Date().toISOString(),
    });
    return Response.json({ ok: true }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
