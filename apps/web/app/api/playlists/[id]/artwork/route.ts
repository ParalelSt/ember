import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { notFound, ownerOnly, playlistAccess } from '@/lib/playlistAccess';

export const PATCH = withRequestLog('playlists/[id]/artwork', async (
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) => {
  try {
    const { pb, user } = await requireUser();
    const { id } = await ctx.params;
    // The cover is the owner's to change, collaborative or not.
    const access = await playlistAccess(pb, user.id, id);
    if (!access) return notFound();
    if (access.role !== 'owner') return ownerOnly();

    const incoming = await request.formData();
    const file = incoming.get('artwork');
    if (!(file instanceof File)) return jsonError('artwork file required', 400);

    // Re-wrap into a fresh FormData for the PB SDK — passing the original
    // request's FormData directly carries extra Next-specific fields.
    const pbForm = new FormData();
    pbForm.append('artwork', file);

    const updated = await pb.collection('playlists').update(id, pbForm);
    const artworkFile = typeof updated.artwork === 'string' ? updated.artwork : '';

    return Response.json({
      playlist: {
        id: updated.id,
        name: String(updated.name ?? ''),
        created_at: String(updated.created ?? ''),
        artwork_url: artworkFile ? `/pb/api/files/playlists/${updated.id}/${artworkFile}` : null,
      },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
