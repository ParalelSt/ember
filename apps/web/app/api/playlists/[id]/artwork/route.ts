import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { pb } = await requireUser();
    const { id } = await ctx.params;

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
}
