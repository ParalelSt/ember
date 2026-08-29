import type { NextRequest } from 'next/server';
import fs from 'node:fs';
import { ForbiddenError, requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { resolveTabPath } from '@/lib/tabs';

/** The bytes of one of your own tabs — AlphaTab loads this into the browser.
 *
 *  Whole-file only: a Guitar Pro file is a couple of hundred KB and the
 *  renderer needs all of it before it can draw anything, so Range serving
 *  would buy nothing. */
export async function GET(_req: NextRequest, ctx: RouteContext<'/api/tabs/files/[id]/download'>) {
  try {
    const { user } = await requireUser();
    const { id } = await ctx.params;
    const pb = await createAdminClient();

    const row = await pb.collection('tabs').getOne(id).catch(() => null);
    if (!row) return jsonError('That tab does not exist.', 404);
    if (row.user !== user.id) throw new ForbiddenError('That tab is not yours.');

    const full = resolveTabPath(String(row.file));
    if (!full || !fs.existsSync(full)) return jsonError('That tab file is missing.', 404);

    const buf = await fs.promises.readFile(full);
    return new Response(new Uint8Array(buf), {
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(buf.length),
        'cache-control': 'private, max-age=3600',
      },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
