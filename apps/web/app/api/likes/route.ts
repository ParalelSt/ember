import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { mapTrackRow } from '@/lib/mapTrack';
import type { Track } from '@/types/track';
import { fromError, jsonError, upsertTrack } from '@/lib/upsertTrack';

export async function GET() {
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from('likes')
      .select('created_at, track:tracks(*)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const tracks = (data ?? [])
      .map((d: { track: unknown }) => mapTrackRow(d.track as Parameters<typeof mapTrackRow>[0]))
      .filter(Boolean);
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
      .from('likes')
      .insert({ user_id: user.id, track_id: track.id });
    if (error && error.code !== '23505') throw error;
    return Response.json({ ok: true }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
