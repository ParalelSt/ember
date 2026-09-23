import type { NextRequest } from 'next/server';
import fs from 'node:fs';
import { requireUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { serveFile } from '@/lib/serveFile';
import { pbDate, PRANK_LIMITS } from '@/lib/pranks/limits';
import { resolvePrankPath } from '@/lib/pranks/media';
import { pranksEnabled } from '@/lib/pranks/settings';
import { prankErrorResponse } from '@/lib/pranks/server';

/** How long after it was sent a delivered prank may still be loading its
 *  file: the longest swap, plus the delivery window, plus slack. */
const LIVE_MS = (PRANK_LIMITS.swapMaxSec + PRANK_LIMITS.expirySec + 60) * 1000;

/** Streams a prank library file with Range support. Admins may always fetch
 *  it (preview). Anyone else only while a prank carrying this file is live
 *  for them: pending inside its window, or delivered and recent. No signed
 *  URLs: the engines all send the session cookie, so one query decides. */
export const GET = withRequestLog('pranks/media/[id]', async (req: NextRequest, ctx: RouteContext<'/api/pranks/media/[id]'>) => {
  try {
    const { user } = await requireUser();
    const { id } = await ctx.params;
    const pb = await createAdminClient();

    if (!user.isAdmin) {
      if (!(await pranksEnabled(pb))) return new Response('forbidden', { status: 403 });
      const now = Date.now();
      const live = await pb.collection('pranks').getList(1, 1, {
        filter: pb.filter(
          'target = {:me} && sound = {:id} && ((status = "pending" && expires_at > {:now}) || (status = "delivered" && created > {:since}))',
          { me: user.id, id, now: pbDate(now), since: pbDate(now - LIVE_MS) },
        ),
      });
      if (live.items.length === 0) return new Response('forbidden', { status: 403 });
    }

    const row = await pb.collection('prank_sounds').getOne(id).catch(() => null);
    if (!row) return new Response('not found', { status: 404 });
    const full = resolvePrankPath(String(row.filename ?? ''));
    if (!full || !fs.existsSync(full)) return new Response('file missing', { status: 404 });

    // Never cached anywhere: access ends when the prank does.
    return serveFile(full, req.headers.get('range'), { 'Cache-Control': 'private, no-store' });
  } catch (e) {
    return prankErrorResponse(e);
  }
});
