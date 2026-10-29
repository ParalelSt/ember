import fs from 'node:fs/promises';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { nullIfNotFound } from '@/lib/pocketbase/notFound';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { serverLogger } from '@/lib/logger/server';
import { COVER_EXTS, mapMyUpload, resolveUploadPath } from '@/lib/uploads';
import { loadOwnUpload, syncCatalogUpload } from '@/lib/uploads/own';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { deleteUploadCover } from '@/lib/uploads/cover';
import { markTrackUnavailable } from '@/lib/trackAvailability';

const MAX_TEXT = 200;

/** Edits an upload's title, artist and album. Uploader or admin only; the
 *  file itself never changes. Fields left out stay as they are; a title
 *  cannot be emptied. The song's row in the shared catalog follows, so
 *  playlists show the new name too. */
export const PATCH = withRequestLog('uploads/[id]', async (request: Request, ctx: RouteContext<'/api/uploads/[id]'>) => {
  try {
    const { user } = await requireUser();
    const { id } = await ctx.params;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError('Invalid body', 400);
    const patch: Record<string, string> = {};
    for (const key of ['title', 'artist', 'album'] as const) {
      const value = body[key];
      if (value === undefined) continue;
      if (typeof value !== 'string') return jsonError(`${key} must be text`, 400);
      patch[key] = value.trim().slice(0, MAX_TEXT);
    }
    if (patch.title === '') return jsonError('A song needs a title', 400);

    const pb = await createAdminClient();
    const own = await loadOwnUpload(pb, id, user);
    if (own.error) return own.error;
    if (Object.keys(patch).length === 0) return Response.json({ upload: mapMyUpload(own.row) });

    const updated = await pb.collection('uploads').update(id, patch);
    await syncCatalogUpload(pb, updated);
    return Response.json({ upload: mapMyUpload(updated) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});

/** Removes an upload, the record and the file on disk. Uploader or admin
 *  only; other people may have it in a playlist, so this is deliberate. */
export const DELETE = withRequestLog('uploads/[id]', async (_request: Request, ctx: RouteContext<'/api/uploads/[id]'>) => {
  try {
    const { user } = await requireUser();
    const { id } = await ctx.params;

    const pb = await createAdminClient();
    const row = await pb.collection('uploads').getOne(id).catch(nullIfNotFound);
    if (!row) return jsonError('Upload not found', 404);
    if (row.uploader !== user.id && !user.isAdmin) {
      return jsonError('Only the person who uploaded this can remove it', 403);
    }

    await pb.collection('uploads').delete(id);
    // Its row in the shared catalog stays (it may sit in someone's playlist
    // or likes), flagged unavailable so those lists stop offering a song
    // whose stream is now a 404. Best effort, never throws.
    await markTrackUnavailable(`upload:${id}`, 'unavailable');

    // Record first, file second: a leftover file is harmless, a record
    // pointing at a missing file is a broken song in someone's playlist.
    const full = resolveUploadPath(String(row.filename ?? ''));
    if (full) {
      await fs.unlink(full).catch((e) => {
        serverLogger.error('api', 'upload file delete failed', { id, filename: row.filename }, e);
      });
    }

    // The cover goes with it, for the same reason. Every format: covers
    // are named after this record, and one written at upload time whose
    // artwork_ext save failed is on disk without the record saying so.
    for (const ext of COVER_EXTS) await deleteUploadCover(id, ext);

    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
