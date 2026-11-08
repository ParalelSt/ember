import type { NextRequest } from 'next/server';
import fs from 'node:fs';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { readUpload } from '@/lib/uploads/record';
import { resolveUploadPath } from '@/lib/uploads';
import { serveFile } from '@/lib/serveFile';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { serverLogger } from '@/lib/logger/server';
import { isPrefetchRequest, PREFETCH_HEADERS, prefetchLimitResponse } from '@/lib/prefetch';
import { streamTokenUser } from '@/lib/streamToken';

/** Serves a member-uploaded song, with Range support (lib/serveFile), to a
 *  signed-in member or to a cast device holding a signed link for it.
 *  `?prefetch=1` (the auto cache, lib/prefetch) shares the stream route's
 *  per-listener limit; an upload is always on disk, so nothing waits. */
export const GET = withRequestLog('uploads/[id]/stream', async (request: NextRequest, ctx: RouteContext<'/api/uploads/[id]/stream'>) => {
  try {
    const { id } = await ctx.params;
    // A cast device has no cookie: a signed link for THIS upload's audio
    // (lib/streamToken) stands in for the member it was issued to.
    if (!streamTokenUser(request, `upload:${id}`, 'stream')) await requireUser();
    const prefetch = isPrefetchRequest(request);
    if (prefetch) {
      const limited = await prefetchLimitResponse(request);
      if (limited) return limited;
    }

    const row = await readUpload(id);
    if (!row) return new Response('not found', { status: 404 });

    // The filename comes from our own record, but resolve defensively anyway,
    // this is the one place a bad value would read an arbitrary file.
    const full = resolveUploadPath(String(row.filename ?? ''));
    if (!full || !fs.existsSync(full)) {
      // The record says the song exists and its file is gone: the host's
      // data, not a listener's mistake. The player only sees a 404, which
      // withRequestLog does not log, so say it here.
      serverLogger.error('uploads', 'upload file missing on disk', { id, filename: row.filename ?? null });
      return new Response('file missing', { status: 404 });
    }

    return serveFile(full, request.headers.get('range'), prefetch ? PREFETCH_HEADERS : {});
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return new Response('stream failed', { status: 500 });
  }
});
