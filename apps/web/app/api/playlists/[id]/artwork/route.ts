import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { notFound, ownerOnly, playlistAccess } from '@/lib/playlistAccess';

/** The playlists.artwork field's own limits (pb_migrations
 *  1749024000_playlist_artwork.js), checked here so a refusal is a sentence
 *  and a 413/415 rather than PocketBase's field error. */
const MAX_ARTWORK_BYTES = 5 * 1024 * 1024;
const ARTWORK_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

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

    // A body that is not multipart makes formData() throw: that is the
    // caller's mistake (400), not a server error.
    const incoming = await request.formData().catch(() => null);
    const file = incoming?.get('artwork');
    if (!(file instanceof File)) return jsonError('artwork file required', 400);
    if (file.size > MAX_ARTWORK_BYTES) return jsonError('That image is too large: the limit is 5 MB', 413);
    if (!ARTWORK_TYPES.has(file.type)) return jsonError('A cover must be a JPEG, PNG, WebP or GIF image', 415);

    // Re-wrap into a fresh FormData for the PB SDK, passing the original
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
