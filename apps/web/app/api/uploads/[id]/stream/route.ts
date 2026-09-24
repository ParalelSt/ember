import type { NextRequest } from 'next/server';
import fs from 'node:fs';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { resolveUploadPath } from '@/lib/uploads';
import { serveFile } from '@/lib/serveFile';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { isPrefetchRequest, PREFETCH_HEADERS, prefetchLimitResponse } from '@/lib/prefetch';

/** Serves a member-uploaded song, with Range support (lib/serveFile).
 *  `?prefetch=1` (the auto cache, lib/prefetch) shares the stream route's
 *  per-listener limit; an upload is always on disk, so nothing waits. */
export const GET = withRequestLog('uploads/[id]/stream', async (request: NextRequest, ctx: RouteContext<'/api/uploads/[id]/stream'>) => {
  try {
    await requireUser();
    const prefetch = isPrefetchRequest(request);
    if (prefetch) {
      const limited = prefetchLimitResponse(request);
      if (limited) return limited;
    }
    const { id } = await ctx.params;

    const pb = await createAdminClient();
    const row = await pb.collection('uploads').getOne(id).catch(() => null);
    if (!row) return new Response('not found', { status: 404 });

    // The filename comes from our own record, but resolve defensively anyway —
    // this is the one place a bad value would read an arbitrary file.
    const full = resolveUploadPath(String(row.filename ?? ''));
    if (!full || !fs.existsSync(full)) return new Response('file missing', { status: 404 });

    return serveFile(full, request.headers.get('range'), prefetch ? PREFETCH_HEADERS : {});
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return new Response('stream failed', { status: 500 });
  }
});
