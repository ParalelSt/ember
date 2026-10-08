import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { clientIp, rateLimitResponse } from '@/lib/rateLimit';
import { linkCookie, normalizeCode } from '@/lib/qrLogin/codes';
import { csrfRefusal } from '@/lib/qrLogin/sameOrigin';
import { hash, isSecret } from '@/lib/qrLogin/secrets';
import { effectiveStatus, parsePbDate } from '@/lib/qrLogin/state';
import { failure, findRow, isHttps, json, noSuchRequest, QR_LIMITS, type LoginRequestRow } from '@/lib/qrLogin/server';

/** The approving device reads the facts for the approve card (plan 2b):
 *  by the token from the QR link or by the typed code. A signed-in member
 *  only, rate limited hard by code (5 per member and 60 in all per 10
 *  minutes) so the code space cannot be walked. Never answers the code, the
 *  token, the poll secret or the requester's address. */
export const POST = withRequestLog('auth/qr/lookup', async (req: NextRequest) => {
  try {
    const refused = csrfRefusal(req);
    if (refused) return refused;
    let user: { id: string };
    try {
      ({ user } = await requireUser());
    } catch (e) {
      if (e instanceof UnauthorizedError) return unauthorizedResponse();
      throw e;
    }
    const body = (await req.json().catch(() => null)) as { token?: unknown; code?: unknown } | null;
    if (!body || typeof body !== 'object' || (body.token === undefined && body.code === undefined)) {
      return json({ error: 'Send the code' }, 400);
    }

    let row: LoginRequestRow | null = null;
    if (body.token !== undefined) {
      const limited = rateLimitResponse(`qr-lookup-token:${user.id}`, QR_LIMITS.lookupToken);
      if (limited) return limited;
      if (!isSecret(body.token)) return noSuchRequest();
      row = await findRow(await createAdminClient(), 'token_hash', hash(body.token));
    } else {
      const limited =
        rateLimitResponse(`qr-lookup-code:${user.id}`, QR_LIMITS.lookupCode) ??
        rateLimitResponse('qr-lookup-code:all', QR_LIMITS.lookupCodeAll);
      if (limited) return limited;
      const code = normalizeCode(body.code);
      if (!code) return noSuchRequest();
      row = await findRow(await createAdminClient(), 'code', code);
    }

    const res = answer(row, req);
    // A token stashed for /link across a sign-in (proxy.ts) has done its job.
    if (body.token !== undefined) res.headers.append('set-cookie', linkCookie('', 0, isHttps(req)));
    return res;
  } catch (e) {
    return failure(e);
  }
});

/** The approve card's facts for a live request, or the same 404 as for
 *  one that never existed. */
function answer(row: LoginRequestRow | null, req: NextRequest): Response {
  const now = Date.now();
  if (!row) return noSuchRequest();
  const status = effectiveStatus(row, now);
  // Only a live request answers. A used, denied or expired one looks like
  // one that never existed, so old codes say nothing for their 30 days.
  if (status !== 'pending' && status !== 'approved') return noSuchRequest();
  const asked = parsePbDate(row.created);
  return json({
    id: row.id,
    device: row.device,
    shell: row.shell,
    askedSecondsAgo: Number.isFinite(asked) ? Math.max(0, Math.round((now - asked) / 1000)) : 0,
    sameNetwork: !!row.requester_ip && row.requester_ip === clientIp(req),
    status,
  });
}
