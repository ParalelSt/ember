import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { jsonError } from '@/lib/upsertTrack';
import { rateLimitResponse } from '@/lib/rateLimit';
import { googleConfig } from '@/lib/import/google/client';
import { beginFlow, FlowError } from '@/lib/import/google/flows';
import { GOOGLE_MESSAGES } from '@/lib/import/sources/ytmusicLiked';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** YouTube Music likes, read after the person signs in with Google.
 *
 *    GET  /api/import/liked/google                  is Google sign-in set up on this server?
 *    POST /api/import/liked/google                  a new sign-in: { flowId, userCode, verificationUrl, expiresIn, interval }
 *    GET  /api/import/liked/google/:flowId          how it stands: { state, preview?, message? }
 *    POST /api/import/liked/google/:flowId/start    queue the transfer: { job, playlistId: null }
 *    DELETE /api/import/liked/google/:flowId        cancel: revoke and forget
 *
 *  The server polls Google itself (lib/import/google/flows.ts); the tokens
 *  live in its memory for the minute it takes to read the likes and never
 *  reach a response, a log or the database. */

export const GET = withRequestLog('import/liked/google', async () => {
  try {
    await requireUser();
    return Response.json({ configured: googleConfig() !== null });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    throw e;
  }
});

export const POST = withRequestLog('import/liked/google', async () => {
  try {
    const { user } = await requireUser();
    const cfg = googleConfig();
    if (!cfg) return jsonError(GOOGLE_MESSAGES.notConfigured, 503);
    // Each one asks Google for a code; a person who needs more than this in
    // an hour is not signing in.
    const limited = rateLimitResponse(`google-signin:${user.id}`, { windowMs: 3_600_000, max: 10 });
    if (limited) return jsonError(GOOGLE_MESSAGES.rateLimited, 429);
    const started = await beginFlow(user.id, cfg);
    return Response.json(started, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    if (e instanceof FlowError) return jsonError(e.message, e.status);
    return jsonError(GOOGLE_MESSAGES.unreachable, 502);
  }
});
