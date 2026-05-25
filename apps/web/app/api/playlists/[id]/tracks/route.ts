import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import type { Track } from '@/types/track';
import { fromError, jsonError, upsertTrack } from '@/lib/upsertTrack';

export async function POST(request: NextRequest, ctx: RouteContext<'/api/playlists/[id]/tracks'>) {
  try {
    const { supabase } = await requireUser();
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as { track?: Track } | null;
    const track = body?.track;
    if (!track?.id) return jsonError('track required', 400);

    await upsertTrack(supabase, track);

    const { data: maxRow } = await supabase
      .from('playlist_tracks')
      .select('position')
      .eq('playlist_id', id)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    const position = (maxRow?.position ?? -1) + 1;
    const { error } = await supabase
      .from('playlist_tracks')
      .insert({ playlist_id: id, track_id: track.id, position });
    if (error) throw error;
    return Response.json({ ok: true }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
