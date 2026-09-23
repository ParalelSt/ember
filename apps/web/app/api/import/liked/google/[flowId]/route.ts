import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { jsonError } from '@/lib/upsertTrack';
import { rateLimitResponse } from '@/lib/rateLimit';
import { cancelFlow, FLOW_ID_RE, flowStatus } from '@/lib/import/google/flows';
import { GOOGLE_MESSAGES } from '@/lib/import/sources/ytmusicLiked';
import { withRequestLog } from '@/lib/logger/withRequestLog';

type Ctx = RouteContext<'/api/import/liked/google/[flowId]'>;

/** How one sign-in stands. The dialog asks every couple of seconds. A sign-in
 *  that is not this person's reads exactly like one that never existed. */
export const GET = withRequestLog('import/liked/google/[flowId]', async (_req: NextRequest, ctx: Ctx) => {
  try {
    const { user } = await requireUser();
    const limited = rateLimitResponse(`google-poll:${user.id}`, { windowMs: 60_000, max: 90 });
    if (limited) return limited;
    const { flowId } = await ctx.params;
    const status = FLOW_ID_RE.test(flowId) ? flowStatus(user.id, flowId) : null;
    if (!status) return Response.json({ state: 'expired', message: GOOGLE_MESSAGES.gone }, { status: 404 });
    return Response.json(status);
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return jsonError(GOOGLE_MESSAGES.readFailed, 500);
  }
});

/** Cancel: the dialog closed, or the person pressed Cancel or Back. */
export const DELETE = withRequestLog('import/liked/google/[flowId]', async (_req: NextRequest, ctx: Ctx) => {
  try {
    const { user } = await requireUser();
    const { flowId } = await ctx.params;
    const cancelled = FLOW_ID_RE.test(flowId) ? await cancelFlow(user.id, flowId) : false;
    return Response.json({ cancelled });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return jsonError(GOOGLE_MESSAGES.readFailed, 500);
  }
});
