import type { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/pocketbase/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { serverLogger } from '@/lib/logger/server';
import { clientIp, rateLimitResponse } from '@/lib/rateLimit';
import { isUniqueHit } from '@/lib/pocketbase/uniqueHit';
import { publicOrigin } from '@/lib/publicOrigin';
import { deviceLabel, shellOf } from '@/lib/qrLogin/device';
import { hash, newSecret, newShortCode } from '@/lib/qrLogin/secrets';
import { qrTtlMs } from '@/lib/qrLogin/state';
import { failure, isHttps, json, pbIso, QR_LIMITS, qrCookie } from '@/lib/qrLogin/server';

/** A new device asks to be signed in (plan 2b). Public: the device has no
 *  session yet, so it is limited per IP. Answers the QR link and the short
 *  code; the poll secret goes only into an httpOnly cookie, so only this
 *  browser can ever collect the session. */
export const POST = withRequestLog('auth/qr/start', async (req: NextRequest) => {
  try {
    const ip = clientIp(req);
    const limited = rateLimitResponse(`qr-start:${ip}`, QR_LIMITS.start);
    if (limited) return limited;

    const body = (await req.json().catch(() => null)) as { shell?: unknown } | null;
    const shell = shellOf(body && typeof body === 'object' ? body.shell : undefined);
    const device = deviceLabel(req.headers.get('user-agent'), shell);
    const ttl = qrTtlMs(process.env.QR_LOGIN_TTL_S);
    const expires = pbIso(Date.now() + ttl);
    const approveToken = newSecret();
    const pollSecret = newSecret();

    const pb = await createAdminClient();
    let created: { id: string; code: string } | null = null;
    for (let attempt = 0; !created; attempt++) {
      try {
        created = (await pb.collection('login_requests').create({
          token_hash: hash(approveToken),
          poll_hash: hash(pollSecret),
          code: newShortCode(),
          status: 'pending',
          device,
          shell,
          requester_ip: ip.slice(0, 64),
          expires,
        }, { requestKey: null })) as unknown as { id: string; code: string };
      } catch (e) {
        // A code already in use (2^40 codes, so almost never): pick another.
        if (attempt >= 4 || !isUniqueHit(e)) throw e;
      }
    }

    serverLogger.info('auth', 'qr started', { requestId: created.id, device });
    const res = json({
      id: created.id,
      code: created.code,
      approveUrl: `${publicOrigin(req)}/link/${approveToken}`,
      expiresAt: expires,
      device,
    });
    res.headers.append('set-cookie', qrCookie(created.id, pollSecret, Math.ceil(ttl / 1000) + 20, isHttps(req)));
    return res;
  } catch (e) {
    return failure(e);
  }
});
