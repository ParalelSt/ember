import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';

export async function DELETE(
  _req: NextRequest,
  ctx: RouteContext<'/api/playlists/[id]/tracks/[trackId]'>,
) {
  try {
    const { supabase } = await requireUser();
    const { id, trackId } = await ctx.params;
    const { error } = await supabase
      .from('playlist_tracks')
      .delete()
      .eq('playlist_id', id)
      .eq('track_id', trackId);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
