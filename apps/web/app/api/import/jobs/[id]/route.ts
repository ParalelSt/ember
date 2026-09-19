import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { createAdminClient } from '@/lib/pocketbase/server';
import { itemFromRecord, jobFromRecord } from '@/lib/import/records';
import { canTransition, isActive, transition, type JobEvent } from '@/lib/import/jobState';
import { kickImportRunner } from '@/lib/import/runnerInstance';
import { withRequestLog } from '@/lib/logger/withRequestLog';

const ACTIONS = ['cancel', 'retry', 'dismiss'] as const;
type Action = (typeof ACTIONS)[number];

/** One import with every item, in source order: the playlist page's
 *  progress, rows and review queue. */
export const GET = withRequestLog('import/jobs/[id]', async (_req: NextRequest, ctx: RouteContext<'/api/import/jobs/[id]'>) => {
  try {
    const { pb } = await requireUser();
    const { id } = await ctx.params;
    // The collection rules only show a user their own jobs.
    const rec = await pb.collection('import_jobs').getOne(id).catch(() => null);
    if (!rec) return jsonError('That import does not exist.', 404);
    const items = await pb.collection('import_items').getFullList({ filter: `job = "${rec.id}"`, sort: 'position' });
    return Response.json({ job: jobFromRecord(rec), items: items.map(itemFromRecord) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});

/** Stop, Retry, or close the Done summary. */
export const PATCH = withRequestLog('import/jobs/[id]', async (request: NextRequest, ctx: RouteContext<'/api/import/jobs/[id]'>) => {
  try {
    const { pb, user } = await requireUser();
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
    const action = ACTIONS.find((a) => a === body?.action) as Action | undefined;
    if (!action) return jsonError('action must be cancel, retry or dismiss', 400);

    const rec = await pb.collection('import_jobs').getOne(id).catch(() => null);
    if (!rec || rec.user !== user.id) return jsonError('That import does not exist.', 404);
    const job = jobFromRecord(rec);
    const admin = await createAdminClient();

    if (action === 'dismiss') {
      if (isActive(job.status)) return jsonError('Stop the import first.', 409);
      const updated = await admin.collection('import_jobs').update(id, { dismissed: true });
      return Response.json({ job: jobFromRecord(updated) });
    }
    const event: JobEvent = action;
    if (!canTransition(job.status, event)) {
      return jsonError(action === 'cancel' ? 'That import has already finished.' : 'That import is not stopped.', 409);
    }
    const updated = await admin.collection('import_jobs').update(id, {
      status: transition(job.status, event),
      error: '',
      retry_at: '',
      runner: '',
    });
    if (action === 'retry') kickImportRunner();
    return Response.json({ job: jobFromRecord(updated) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
