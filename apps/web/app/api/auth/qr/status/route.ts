import type { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/pocketbase/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { serverLogger } from '@/lib/logger/server';
import { clientIp, rateLimitResponse } from '@/lib/rateLimit';
import { hash, sameHash } from '@/lib/qrLogin/secrets';
import { effectiveStatus } from '@/lib/qrLogin/state';
import {
  clearQrCookie,
  failure,
  getRow,
  isHttps,
  json,
  noSuchRequest,
  QR_LIMITS,
  readQrCookie,
  withLock,
} from '@/lib/qrLogin/server';

/** The new device polls here (plan 2b). Only the holder of the poll cookie
 *  gets an answer; a wrong or missing cookie looks exactly like an unknown
 *  request. Once approved, the session is minted and handed over ONCE (the
 *  hook claims the row as used in the same transaction) and the cookie is
 *  cleared. */
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
        res.headers.append('set-cookie', clearQrCookie(row.id, https));
        return res;
      }
      // PocketBase claims the request (approved -> used) and mints in one
      // transaction (pb_hooks/qr_login.pb.js), so even several server
      // processes polling at once deliver it once. The lock above only saves
      // the round trip within this process.
      let session: { token: string; record: Record<string, unknown> };
      try {
        session = await pb.send('/api/ember/qr-login/mint', { method: 'POST', body: { request: row.id }, requestKey: null });
      } catch (e) {
        const err = e as { status?: number; response?: { data?: { status?: unknown } } };
        if (err?.status === 409 || err?.status === 404) {
          const claimed = err.response?.data?.status;
          const res = json({ status: err.status === 409 && (claimed === 'used' || claimed === 'denied') ? claimed : 'expired' });
          res.headers.append('set-cookie', clearQrCookie(row.id, https));
          return res;
        }
        serverLogger.warn('auth', 'qr mint failed', { requestId: row.id, status: err?.status });
        return json({ error: "Can't reach Ember, retrying..." }, 503);
      }
      serverLogger.info('auth', 'qr delivered', { requestId: row.id, userId: row.user, device: row.device });
      const res = json({ status: 'approved', token: session.token, record: session.record });
      res.headers.append('set-cookie', clearQrCookie(row.id, https));
      return res;
    });
  } catch (e) {
    return failure(e);
  }
});
