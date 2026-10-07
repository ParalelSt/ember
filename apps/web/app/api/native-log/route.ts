import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { serverLogger } from '@/lib/logger/server';
import { rateLimitResponse } from '@/lib/rateLimit';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { NATIVE_LOG_LIMITS, NativeLogBodySchema, toNativeEntries } from '@/lib/logger/nativeLog';

/** A batch of the phone app's own player log (PlaybackLog.kt): what the
 *  player did in Android Auto or the AAOS car, where no page is open to log
 *  it. Members only (the app sends the session cookie), rate limited per
 *  member, size limited, schema checked, scrubbed again here, and stored in
 *  the daily server log as category 'native' (lib/logger/nativeLog.ts). */
export const POST = withRequestLog('native-log', async (request: NextRequest) => {
  try {
    const { user } = await requireUser();

    const limited = rateLimitResponse(`native-log:${user.id}`, NATIVE_LOG_LIMITS.rate);
    if (limited) return limited;

    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared > NATIVE_LOG_LIMITS.maxBodyBytes) return jsonError('Log batch too large', 413);
    const text = await request.text();
    if (Buffer.byteLength(text, 'utf8') > NATIVE_LOG_LIMITS.maxBodyBytes) return jsonError('Log batch too large', 413);

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return jsonError('Invalid log batch', 400);
    }
    const parsed = NativeLogBodySchema.safeParse(raw);
    if (!parsed.success) return jsonError('Invalid log batch', 400);

    const reqId = request.headers.get('x-request-id') || randomUUID();
    const entries = toNativeEntries(parsed.data, { userId: user.id, reqId });
    for (const entry of entries) serverLogger.append(entry);
    return Response.json({ ok: true, stored: entries.length });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});

