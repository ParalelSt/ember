import fs from 'node:fs';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { hasUploadArt, resolveUploadPath } from '@/lib/uploads';
import { COVER_MIME, coverFilename } from '@/lib/uploads/cover';

/** Serves the cover extracted from a member upload's tag at upload time.
 *
 *  Auth matches the stream route: uploads are a shared library, so any signed
 *  in member may see them, and nobody else may. Unlike the stream route there
 *  is no Range handling: these are small images the browser wants whole.
 *
 *  The bytes for a given upload never change (a new cover would mean a new
 *  upload), so this is cached hard; `private` because it sits behind auth. */
export async function GET(_request: Request, ctx: RouteContext<'/api/uploads/[id]/art'>) {
  try {
    await requireUser();
    const { id } = await ctx.params;

    const pb = await createAdminClient();
    const row = await pb.collection('uploads').getOne(id).catch(() => null);
    if (!row || !hasUploadArt(row)) return new Response('not found', { status: 404 });

    const ext = String(row.artwork_ext);
    // Resolve from our own record id, and defensively, for the same reason
    // the stream route does: this is a path built from request input.
    const full = resolveUploadPath(coverFilename(row.id, ext));
    if (!full || !fs.existsSync(full)) return new Response('not found', { status: 404 });

    const body = await fs.promises.readFile(full);
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: {
        'Content-Type': COVER_MIME[ext],
        'Content-Length': String(body.length),
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return new Response('artwork failed', { status: 500 });
  }
}
