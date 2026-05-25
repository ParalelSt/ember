import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';

export async function DELETE(_req: NextRequest, ctx: RouteContext<'/api/likes/[trackId]'>) {
  try {
    const { supabase } = await requireUser();
    const { trackId } = await ctx.params;
    const { error } = await supabase.from('likes').delete().eq('track_id', trackId);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
