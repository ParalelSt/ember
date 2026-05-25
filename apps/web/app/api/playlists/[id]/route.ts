import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { mapTrackRow } from '@/lib/mapTrack';
import { fromError } from '@/lib/upsertTrack';

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/playlists/[id]'>) {
  try {
    const { supabase } = await requireUser();
    const { id } = await ctx.params;
    const { data: playlist, error: pErr } = await supabase
      .from('playlists')
      .select('id, name, created_at')
      .eq('id', id)
      .single();
    if (pErr) throw pErr;
    const { data: items, error: iErr } = await supabase
      .from('playlist_tracks')
      .select('position, track:tracks(*)')
      .eq('playlist_id', id)
      .order('position');
    if (iErr) throw iErr;
    const tracks = (items ?? [])
      .map((i: { track: unknown }) => mapTrackRow(i.track as Parameters<typeof mapTrackRow>[0]))
      .filter(Boolean);
    return Response.json({ playlist, tracks });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<'/api/playlists/[id]'>) {
  try {
    const { supabase } = await requireUser();
    const { id } = await ctx.params;
    const { error } = await supabase.from('playlists').delete().eq('id', id);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
