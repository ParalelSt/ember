import type { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/pocketbase/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { serverLogger } from '@/lib/logger/server';
import { clientIp, rateLimitResponse } from '@/lib/rateLimit';
import { hash, sameHash } from '@/lib/qrLogin/secrets';
import { effectiveStatus, transition } from '@/lib/qrLogin/state';
import {
  clearQrCookie,
  failure,
  getRow,
  isHttps,
  json,
  noSuchRequest,
  pbIso,
  QR_LIMITS,
  readQrCookie,
  withLock,
} from '@/lib/qrLogin/server';

/** The new device polls here (plan 2b). Only the holder of the poll cookie
 *  gets an answer; a wrong or missing cookie looks exactly like an unknown
 *  request. Once approved, the session is minted and handed over ONCE, the
 *  row becomes used and the cookie is cleared. */
export const GET = withRequestLog('auth/qr/status', async (req: NextRequest) => {
  try {
    const limited = rateLimitResponse(`qr-status-ip:${clientIp(req)}`, QR_LIMITS.statusPerIp);
    if (limited) return limited;
    const held = readQrCookie(req);
    if (!held) return noSuchRequest();
    // Per request AND holder: a guess at someone's id cannot eat their budget.
    const perRequest = rateLimitResponse(`qr-status:${held.id}:${hash(held.secret).slice(0, 16)}`, QR_LIMITS.statusPerRequest);
    if (perRequest) return perRequest;

    const pb = await createAdminClient();
    const https = isHttps(req);
    return await withLock(held.id, async () => {
      const row = await getRow(pb, held.id);
      if (!row || !sameHash(hash(held.secret), row.poll_hash)) return noSuchRequest();
      const now = Date.now();
      const status = effectiveStatus(row, now);
      if (status === 'pending') return json({ status });
      if (status !== 'approved') {
        const res = json({ status });
        res.headers.append('set-cookie', clearQrCookie(https));
        return res;
      }
      const next = transition(row, 'deliver', now);
      if (!next.ok) return json({ status: next.error });

      // Claim first, so nothing can deliver twice even if the mint is slow.
      await pb.collection('login_requests').update(row.id, { status: 'used', used_at: pbIso(now) }, { requestKey: null });
      let session: { token: string; record: Record<string, unknown> };
      try {
        session = await pb.send('/api/ember/qr-login/mint', { method: 'POST', body: { user: row.user }, requestKey: null });
      } catch (e) {
        const mintStatus = (e as { status?: number })?.status;
        if (mintStatus === 404) {
          // The member is gone: nothing to sign in as.
          await pb.collection('login_requests').update(row.id, { status: 'expired' }, { requestKey: null });
          return json({ status: 'expired' });
        }
        await pb.collection('login_requests').update(row.id, { status: 'approved', used_at: '' }, { requestKey: null });
        serverLogger.warn('auth', 'qr mint failed', { requestId: row.id, status: mintStatus });
        return json({ error: "Can't reach Ember, retrying..." }, 503);
      }
      try {
        await pb.collection('login_requests').update(row.id, { minted_hash: hash(session.token) }, { requestKey: null });
      } catch {
        // The audit hash is for per-device sign-out later; the sign-in stands.
      }
      serverLogger.info('auth', 'qr delivered', { requestId: row.id, userId: row.user, device: row.device });
      const res = json({ status: 'approved', token: session.token, record: session.record });
      res.headers.append('set-cookie', clearQrCookie(https));
      return res;
    });
  } catch (e) {
    return failure(e);
  }
});
