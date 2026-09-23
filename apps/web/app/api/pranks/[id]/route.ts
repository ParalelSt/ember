import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { rateLimitResponse } from '@/lib/rateLimit';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { applyAck, parsePbDate } from '@/lib/pranks/limits';
import { prankErrorResponse } from '@/lib/pranks/server';
import type { PrankStatus } from '@/lib/pranks/types';

/** The target's app acknowledges a prank: pending to delivered or skipped,
 *  delivered to done. Only its own rows; anyone else's reads as not found. */
export const PATCH = withRequestLog('pranks/[id]', async (req: NextRequest, ctx: RouteContext<'/api/pranks/[id]'>) => {
  try {
    const { user } = await requireUser();
    const limited = rateLimitResponse(`prank-ack:${user.id}`, { windowMs: 60_000, max: 60 });
    if (limited) return limited;
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.status !== 'string') {
      return Response.json({ error: 'status is required' }, { status: 400 });
    }

    const pb = await createAdminClient();
    let row;
    try {
      row = await pb.collection('pranks').getOne(id);
    } catch (e) {
      if ((e as { status?: number })?.status === 404) return Response.json({ error: 'Not found' }, { status: 404 });
      throw e;
    }
    if (String(row.target) !== user.id) return Response.json({ error: 'Not found' }, { status: 404 });

    const result = applyAck(
      { status: row.status as PrankStatus, expiresAtMs: parsePbDate(row.expires_at) },
      {
        status: body.status,
        reason: typeof body.reason === 'string' ? body.reason : undefined,
        engine: typeof body.engine === 'string' ? body.engine : undefined,
        appVersion: typeof body.appVersion === 'string' ? body.appVersion : undefined,
        playedSec: typeof body.playedSec === 'number' ? body.playedSec : undefined,
      },
      Date.now(),
    );
    if (!result.ok) {
      // Too late: record what the admin log already says.
      if (result.status === 410) await pb.collection('pranks').update(id, { status: 'expired' });
      return Response.json({ error: result.error }, { status: result.status });
    }
    await pb.collection('pranks').update(id, result.patch);
    return Response.json({ ok: true });
  } catch (e) {
    return prankErrorResponse(e);
  }
});
