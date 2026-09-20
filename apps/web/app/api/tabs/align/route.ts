import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { jsonError } from '@/lib/upsertTrack';
import { rateLimitResponse } from '@/lib/rateLimit';
import { serverLogger } from '@/lib/logger/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { canView } from '@/lib/tabStore';
import { alignmentStatus, alignTab } from '@/lib/tabAlign';

/** Lining a tab up with the recording (docs/tabs-v3.md section 3).
 *
 *  GET  ?tabId=…  how it stands: ready (with the timing), running, failed
 *                 (with the reason) or none.
 *  POST { tabId } start it, or join the one running: the "Line it up"
 *                 button and the ⋯ menu's "Line it up again". Answers at
 *                 once with "running"; the page asks again with GET.
 *
 *  A tab found online is lined up on its own when it is fetched
 *  (lib/tabFetch/online.ts), so this is for a second try and for tabs
 *  fetched before. Listening costs CPU, so it is one job at a time for the
 *  whole server (lib/pythonJobs.ts) and rate limited per member. */

async function rowFor(tabId: string, viewer: { id: string; isAdmin: boolean }) {
  const pb = await createAdminClient();
  const row = await pb.collection('tabs').getOne(tabId).catch(() => null);
  if (!row || !(canView(row, viewer) || viewer.isAdmin)) return { pb, row: null };
  return { pb, row };
}

export const GET = withRequestLog('tabs/align', async (request: NextRequest) => {
  try {
    const { user } = await requireUser();
    const tabId = (request.nextUrl.searchParams.get('tabId') ?? '').slice(0, 40);
    if (!tabId) return jsonError('tabId required', 400);
    const { row } = await rowFor(tabId, user);
    if (!row) return jsonError('That tab does not exist.', 404);
    return Response.json(alignmentStatus(row));
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    serverLogger.error('tabs', 'alignment status failed', undefined, e);
    return Response.json({ status: 'none' });
  }
});

export const POST = withRequestLog('tabs/align', async (request: NextRequest) => {
  try {
    const { user } = await requireUser();
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const tabId = typeof body?.tabId === 'string' ? body.tabId.slice(0, 40) : '';
    if (!tabId) return jsonError('tabId required', 400);
    const { pb, row } = await rowFor(tabId, user);
    if (!row) return jsonError('That tab does not exist.', 404);

    // Joining a job already running is free; starting one is not.
    if (alignmentStatus(row).status !== 'running') {
      const limited = rateLimitResponse(`tabs-align:${user.id}`, { windowMs: 60 * 60 * 1000, max: 20 });
      if (limited) return limited;
    }
    // Started, not awaited: listening takes tens of seconds and the page
    // asks how it went (GET) while it runs.
    void alignTab(pb, row, { freshPb: createAdminClient }).catch(() => undefined);
    return Response.json({ status: 'running' }, { status: 202 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    serverLogger.error('tabs', 'lining up route failed', undefined, e);
    return jsonError('Could not line that tab up just now.', 500);
  }
});
