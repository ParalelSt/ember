import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { mapTrackRow } from '@/lib/mapTrack';
import type { Track } from '@/types/track';
import { fromError, jsonError, upsertTrack } from '@/lib/upsertTrack';

export async function GET() {
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from('plays')
      .select('played_at, track:tracks(*)')
      .order('played_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    const seen = new Set<string>();
    const tracks = [];
    for (const row of (data ?? []) as { track: unknown }[]) {
      const track = Array.isArray(row.track) ? row.track[0] : row.track;
      const mapped = mapTrackRow(track as Parameters<typeof mapTrackRow>[0]);
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
    const { supabase, user } = await requireUser();
    const body = (await request.json().catch(() => null)) as { track?: Track } | null;
    const track = body?.track;
    if (!track?.id) return jsonError('track required', 400);

    await upsertTrack(supabase, track);

    const { error } = await supabase
      .from('plays')
      .insert({ user_id: user.id, track_id: track.id });
    if (error) throw error;
    return Response.json({ ok: true }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
