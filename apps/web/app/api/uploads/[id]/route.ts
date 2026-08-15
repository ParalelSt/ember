import fs from 'node:fs/promises';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { serverLogger } from '@/lib/logger/server';
import { resolveUploadPath } from '@/lib/uploads';

/** Removes an upload — the record and the file on disk. Uploader or admin
 *  only; other people may have it in a playlist, so this is deliberate. */
export async function DELETE(_request: Request, ctx: RouteContext<'/api/uploads/[id]'>) {
  try {
    const { user } = await requireUser();
    const { id } = await ctx.params;

    const pb = await createAdminClient();
    const row = await pb.collection('uploads').getOne(id).catch(() => null);
    if (!row) return jsonError('Upload not found', 404);
    if (row.uploader !== user.id && !user.isAdmin) {
      return jsonError('Only the person who uploaded this can remove it', 403);
    }

    await pb.collection('uploads').delete(id);

    // Record first, file second: a leftover file is harmless, a record
    // pointing at a missing file is a broken song in someone's playlist.
    const full = resolveUploadPath(String(row.filename ?? ''));
    if (full) {
      await fs.unlink(full).catch((e) => {
        serverLogger.error('api', 'upload file delete failed', { id, filename: row.filename }, e);
      });
    }

    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
