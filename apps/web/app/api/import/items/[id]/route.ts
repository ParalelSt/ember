import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { createAdminClient } from '@/lib/pocketbase/server';
import { cleanPickedTrack, itemFromRecord, jobFromRecord } from '@/lib/import/records';
import { pickItem, skipItem } from '@/lib/import/store';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** Settle one imported song by hand, from the review sheet or a track's
 *  "Wrong song? Re-match":
 *
 *    { action: 'pick', track }  put this YouTube video in the playlist at the
 *                               song's source position (a re-pick swaps the
 *                               old one out in place)
 *    { action: 'skip' }         leave the song out ("Remove song") */
export const POST = withRequestLog('import/items/[id]', async (request: NextRequest, ctx: RouteContext<'/api/import/items/[id]'>) => {
  try {
    const { pb, user } = await requireUser();
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as { action?: unknown; track?: unknown } | null;

    const itemRec = await pb.collection('import_items').getOne(id).catch(() => null);
    const jobRec = itemRec ? await pb.collection('import_jobs').getOne(String(itemRec.job)).catch(() => null) : null;
    // Admins can read anyone's import, but only its owner changes it.
    if (!itemRec || !jobRec || jobRec.user !== user.id) return jsonError('That song is not in one of your imports.', 404);
    const item = itemFromRecord(itemRec);
    const job = jobFromRecord(jobRec);
    if (item.status === 'pending') return jsonError('That song has not been matched yet.', 409);

    const admin = await createAdminClient();
    if (body?.action === 'pick') {
      const track = cleanPickedTrack(body.track);
      if (!track) return jsonError('Pick a YouTube song.', 400);
      await pickItem(admin, job, item, track);
    } else if (body?.action === 'skip') {
      if (item.status !== 'review' && item.status !== 'missing') return jsonError('Only an unsure song can be left out.', 409);
      await skipItem(admin, job, item);
    } else {
      return jsonError('action must be pick or skip', 400);
    }
    const [fresh, freshJob] = await Promise.all([
      admin.collection('import_items').getOne(id),
      admin.collection('import_jobs').getOne(job.id),
    ]);
    return Response.json({ item: itemFromRecord(fresh), job: jobFromRecord(freshJob) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
