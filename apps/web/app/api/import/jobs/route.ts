import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { rateLimitResponse } from '@/lib/rateLimit';
import { createAdminClient } from '@/lib/pocketbase/server';
import { parseImportUrl } from '@/lib/import/url';
import { inspectLink } from '@/lib/import/inspect';
import { jobFromRecord } from '@/lib/import/records';
import { attachCover, createImportJob } from '@/lib/import/store';
import { kickImportRunner } from '@/lib/import/runnerInstance';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** The signed-in user's imports the sidebar still shows: running ones and
 *  finished ones whose summary has not been closed. */
export const GET = withRequestLog('import/jobs', async () => {
  try {
    const { pb, user } = await requireUser();
    const list = await pb.collection('import_jobs').getList(1, 50, {
      filter: `user = "${user.id}" && dismissed = false`,
      sort: '-created',
    });
    return Response.json({ jobs: list.items.map(jobFromRecord) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});

/** Start an import: the playlist is created now, named after the source,
 *  and the job is queued for the server's runner. The dialog closes on the
 *  answer; the sidebar and the playlist page follow the job from here. */
export const POST = withRequestLog('import/jobs', async (request: NextRequest) => {
  try {
    const { user } = await requireUser();
    const limited = rateLimitResponse(`import-start:${user.id}`, { windowMs: 600_000, max: 5 });
    if (limited) return limited;

    const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
    const url = typeof body?.url === 'string' ? body.url.trim().slice(0, 500) : '';
    const parsed = url ? parseImportUrl(url) : null;
    if (!parsed) return jsonError('Paste a Spotify or YouTube Music playlist link.', 400);

    const src = await inspectLink(user.id, parsed);
    const count = src.source === 'spotify' ? src.items.length : src.tracks.length;
    if (!count) return jsonError('That playlist has no songs Ember can import.', 400);

    const admin = await createAdminClient();
    const { job, playlistId } = await createImportJob(admin, {
      userId: user.id,
      source: src.source,
      sourceId: src.id,
      sourceUrl: url,
      name: src.name,
      coverUrl: src.source === 'spotify' ? src.coverUrl : null,
      ...(src.source === 'spotify' ? { items: src.items } : { tracks: src.tracks }),
    });
    kickImportRunner();
    if (playlistId && job.coverUrl) void attachCover(admin, playlistId, job.coverUrl);
    return Response.json({ job, playlistId }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
