import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { rateLimitResponse } from '@/lib/rateLimit';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { capWords, personName } from '@/lib/pranks/copy';
import { checkCaps, normaliseParams, pbDate, PRANK_KINDS, PRANK_LIMITS } from '@/lib/pranks/limits';
import { pranksEnabled } from '@/lib/pranks/settings';
import { effectiveStatus, prankErrorResponse, toLogEntry, toRecent } from '@/lib/pranks/server';
import type { PrankKind } from '@/lib/pranks/types';

const HOUR_MS = 60 * 60 * 1000;
const LOG_SIZE = 200;

/** Send a prank: one `pranks` row, pending for 45 s. This route is the only
 *  writer (the collection's create rule is null). Only `ping` exists until
 *  the prank library lands; sounds and swaps need its media. */
export const POST = withRequestLog('admin/pranks', async (req: NextRequest) => {
  try {
    const { user } = await requireAdmin();
    const limited = rateLimitResponse(`prank-create:${user.id}`, { windowMs: 60_000, max: 30 });
    if (limited) return limited;

    const body = (await req.json().catch(() => null)) as { targetId?: unknown; kind?: unknown; params?: unknown } | null;
    const targetId = typeof body?.targetId === 'string' ? body.targetId : '';
    const kind = body?.kind as PrankKind;
    if (!targetId || !PRANK_KINDS.includes(kind)) {
      return Response.json({ error: 'Pick a person and a prank' }, { status: 400 });
    }
    if (kind !== 'ping') {
      return Response.json({ error: 'Sounds and swaps arrive with the prank library' }, { status: 400 });
    }

    const pb = await createAdminClient();
    if (!(await pranksEnabled(pb))) {
      return Response.json({ error: 'Pranks are switched off' }, { status: 409 });
    }
    let target;
    try {
      target = await pb.collection('users').getOne(targetId);
    } catch (e) {
      if ((e as { status?: number })?.status === 404) return Response.json({ error: 'No such person' }, { status: 404 });
      throw e;
    }

    const now = Date.now();
    const since = pbDate(now - HOUR_MS);
    const [forTarget, byAdmin] = await Promise.all([
      pb.collection('pranks').getFullList({ filter: pb.filter('target = {:t} && created >= {:since}', { t: targetId, since }) }),
      pb.collection('pranks').getFullList({ filter: pb.filter('issued_by = {:a} && created >= {:since}', { a: user.id, since }) }),
    ]);
    const cap = checkCaps(kind, forTarget.map((r) => toRecent(r, now)), byAdmin.map((r) => toRecent(r, now)), now);
    if (!cap.ok) {
      return Response.json(
        { error: capWords(cap.reason, personName(target), cap.retryAfterSec), reason: cap.reason },
        { status: 429, headers: { 'Retry-After': String(cap.retryAfterSec) } },
      );
    }

    const row = await pb.collection('pranks').create({
      target: targetId,
      issued_by: user.id,
      kind,
      params: normaliseParams(kind, body?.params),
      status: 'pending',
      expires_at: pbDate(now + PRANK_LIMITS.expirySec * 1000),
    });
    const names = new Map([[targetId, personName(target)], [user.id, 'You']]);
    return Response.json({ prank: toLogEntry(row, names, now) }, { status: 201 });
  } catch (e) {
    return prankErrorResponse(e);
  }
});

/** The log: newest 200 pranks (optionally one person's), in words. Pending
 *  rows past their window are written back as expired here, lazily, so the
 *  log and the collection agree without a background job. */
export const GET = withRequestLog('admin/pranks', async (req: NextRequest) => {
  try {
    const { user } = await requireAdmin();
    const limited = rateLimitResponse(`prank-log:${user.id}`, { windowMs: 60_000, max: 120 });
    if (limited) return limited;

    const pb = await createAdminClient();
    const target = req.nextUrl.searchParams.get('target');
    const [page, users, enabled] = await Promise.all([
      pb.collection('pranks').getList(1, LOG_SIZE, {
        filter: target ? pb.filter('target = {:t}', { t: target }) : '',
        sort: '-created',
      }),
      pb.collection('users').getFullList({ fields: 'id,name,email' }),
      pranksEnabled(pb),
    ]);
    const names = new Map(users.map((u) => [u.id, personName(u)]));
    const now = Date.now();

    const stale = page.items.filter((r) => r.status === 'pending' && effectiveStatus(r, now) === 'expired');
    await Promise.all(stale.map((r) => pb.collection('pranks').update(r.id, { status: 'expired' }).catch(() => null)));

    return Response.json({ pranks: page.items.map((r) => toLogEntry(r, names, now)), enabled });
  } catch (e) {
    return prankErrorResponse(e);
  }
});
