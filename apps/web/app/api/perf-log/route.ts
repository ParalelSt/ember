import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { rateLimitResponse } from '@/lib/rateLimit';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { perfLogEnabled, perfSample } from '@/lib/perf/hostSwitch';
import { appendPerf } from '@/lib/perf/store';
import { cleanDigest, PERF_LOG_LIMITS, PerfDigestSchema } from '@/lib/perf/upload';

/** The page's perf digest (lib/perf/client.ts): every few minutes while
 *  the app is open and when it is hidden, at most 2 KB. Members only, rate
 *  limited, size limited, schema checked, stored in the perf store
 *  (lib/perf/store.ts) under the member's id for an admin to read.
 *
 *  The kill switch: with EMBER_PERF_LOG=off both answers are
 *  `{ off: true }` and the page stops its perf log for the session. */

/** Asked once per page session: is perf logging on, and for what share. */
export const GET = withRequestLog('perf-log', async () => {
  if (!perfLogEnabled()) return Response.json({ off: true });
  return Response.json({ on: true, sample: perfSample() });
});

export const POST = withRequestLog('perf-log', async (request: NextRequest) => {
  try {
    if (!perfLogEnabled()) return Response.json({ off: true });
    const { user } = await requireUser();

    const limited = rateLimitResponse(`perf-log:${user.id}`, PERF_LOG_LIMITS.rate);
    if (limited) return limited;

    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared > PERF_LOG_LIMITS.maxBodyBytes) return jsonError('Perf digest too large', 413);
    const text = await request.text();
    if (Buffer.byteLength(text, 'utf8') > PERF_LOG_LIMITS.maxBodyBytes) return jsonError('Perf digest too large', 413);

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return jsonError('Invalid perf digest', 400);
    }
    const parsed = PerfDigestSchema.safeParse(raw);
    if (!parsed.success) return jsonError('Invalid perf digest', 400);

    const reqId = request.headers.get('x-request-id') || randomUUID();
    const stored = await appendPerf({ ts: Date.now(), userId: user.id, reqId, digest: cleanDigest(parsed.data) });
    return Response.json({ ok: true, stored, sample: perfSample() });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
