import type { NextRequest } from 'next/server';
import fs from 'node:fs';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { resolveRowPath } from '@/lib/tabs';
import { canView, isRetired } from '@/lib/tabStore';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** The bytes of a tab you can see (shared, or your own): AlphaTab loads
 *  this into the browser. A private tab of someone else's is a 404.
 *
 *  Whole-file only: a Guitar Pro file is a couple of hundred KB and the
 *  renderer needs all of it before it can draw anything, so Range serving
 *  would buy nothing.
 *
 *  A tab generated from the recording by an older server is no longer
 *  served: a stale link to one gets a plain 410, never the rough notes. */
export const GET = withRequestLog('tabs/files/[id]/download', async (_req: NextRequest, ctx: RouteContext<'/api/tabs/files/[id]/download'>) => {
  try {
    const { user } = await requireUser();
    const { id } = await ctx.params;
    const pb = await createAdminClient();

    const row = await pb.collection('tabs').getOne(id).catch(() => null);
    if (!row || !canView(row, user)) return jsonError('That tab does not exist.', 404);
    if (isRetired(row)) return jsonError('That tab is no longer available.', 410);

    const full = resolveRowPath(row);
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
});
