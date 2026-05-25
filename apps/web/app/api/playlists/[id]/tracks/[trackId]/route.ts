import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';

export async function DELETE(
  _req: NextRequest,
  ctx: RouteContext<'/api/playlists/[id]/tracks/[trackId]'>,
) {
  try {
    const { pb } = await requireUser();
    const { id, trackId } = await ctx.params;

    // The route takes the external (app-facing) trackId; resolve it to the
    // PocketBase record id, then delete the junction row.
    const trackRec = await pb
      .collection('tracks')
      .getFirstListItem(`external_id = "${esc(trackId)}"`);

    const junction = await pb
      .collection('playlist_tracks')
      .getFirstListItem(`playlist = "${esc(id)}" && track = "${trackRec.id}"`);

    await pb.collection('playlist_tracks').delete(junction.id);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
