import type { RecordModel } from 'pocketbase';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { rateLimitResponse } from '@/lib/rateLimit';
import { mapMyUpload } from '@/lib/uploads';
import { MAX_COVER_BYTES, deleteUploadCover, sniffCoverImage, writeUploadCover } from '@/lib/uploads/cover';
import { loadOwnUpload, syncCatalogUpload } from '@/lib/uploads/own';

/** An upload's cover, set or removed by hand (Settings > Uploads > Edit
 *  details). Uploader or admin only.
 *
 *  POST, multipart `file`: a JPEG or PNG up to MAX_COVER_BYTES, checked by
 *        its bytes. Stored exactly like a cover extracted at upload time
 *        (MUSIC_DIR/uploads/<id>.<ext>, `artwork_ext` on the record), so the
 *        art route, the player and the offline downloader need no change.
 *  DELETE: removes the file and clears `artwork_ext`.
 *
 *  Either way `artwork_v` goes up, which changes the cover URL (the art
 *  route caches a cover for a year under its URL). */

const MULTIPART_MARGIN = 64 * 1024;
const tooLarge = () => jsonError(`That image is too large: the limit is ${Math.round(MAX_COVER_BYTES / 1024 / 1024)} MB`, 413);

const nextVersion = (row: RecordModel) => {
  const v = Number(row.artwork_v ?? 0);
  return (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0) + 1;
};

export const POST = withRequestLog('uploads/[id]/cover', async (request: Request, ctx: RouteContext<'/api/uploads/[id]/cover'>) => {
  try {
    const { user } = await requireUser();
    const { id } = await ctx.params;
    const limited = rateLimitResponse(`upload-cover:${user.id}`, { windowMs: 60 * 1000, max: 20 });
    if (limited) return limited;

    const declared = Number(request.headers.get('content-length') ?? 0);
    if (Number.isFinite(declared) && declared > MAX_COVER_BYTES + MULTIPART_MARGIN) return tooLarge();

    const pb = await createAdminClient();
    const own = await loadOwnUpload(pb, id, user);
    if (own.error) return own.error;

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) return jsonError('No image uploaded', 400);
    if (file.size === 0) return jsonError('That image is empty', 400);
    if (file.size > MAX_COVER_BYTES) return tooLarge();

    const data = Buffer.from(await file.arrayBuffer());
    const ext = sniffCoverImage(data);
    if (!ext) return jsonError('A cover must be a JPEG or PNG image', 415);

    const oldExt = String(own.row.artwork_ext ?? '');
    if (!(await writeUploadCover(own.row.id, ext, data, oldExt))) return jsonError('Could not store the cover', 500);

    const updated = await pb.collection('uploads').update(own.row.id, { artwork_ext: ext, artwork_v: nextVersion(own.row) });
    await syncCatalogUpload(pb, updated);
    return Response.json({ upload: mapMyUpload(updated) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});

export const DELETE = withRequestLog('uploads/[id]/cover', async (_request: Request, ctx: RouteContext<'/api/uploads/[id]/cover'>) => {
  try {
    const { user } = await requireUser();
    const { id } = await ctx.params;

    const pb = await createAdminClient();
    const own = await loadOwnUpload(pb, id, user);
    if (own.error) return own.error;

    const oldExt = String(own.row.artwork_ext ?? '');
    // Record first, file second, as the delete route does: a leftover file
    // is harmless, a record pointing at a missing one is a broken cover.
    const updated = await pb.collection('uploads').update(own.row.id, { artwork_ext: '', artwork_v: nextVersion(own.row) });
    await deleteUploadCover(own.row.id, oldExt);
    await syncCatalogUpload(pb, updated);
    return Response.json({ upload: mapMyUpload(updated) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
