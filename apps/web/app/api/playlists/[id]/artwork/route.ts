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

/** Which of those the bytes are, or null. For a file the browser sent
 *  without a type (some phone file pickers do): PocketBase reads the type
 *  from the bytes, and took those files before this route checked. */
function sniffArtworkType(head: Uint8Array): string | null {
  const at = (offset: number, bytes: number[]) => bytes.every((b, i) => head[offset + i] === b);
  if (at(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (at(0, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp';
  return null;
}

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
    // No type given (or only "some bytes"): the bytes decide, as in PocketBase.
    const untyped = file.type === '' || file.type === 'application/octet-stream';
    const type = untyped ? sniffArtworkType(new Uint8Array(await file.slice(0, 12).arrayBuffer())) : file.type;
    if (!type || !ARTWORK_TYPES.has(type)) return jsonError('A cover must be a JPEG, PNG, WebP or GIF image', 415);

    // Re-wrap into a fresh FormData for the PB SDK, passing the original
    // request's FormData directly carries extra Next-specific fields.
    const pbForm = new FormData();
    pbForm.append('artwork', untyped ? new File([file], file.name, { type }) : file);

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
