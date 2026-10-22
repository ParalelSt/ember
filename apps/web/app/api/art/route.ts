import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { ART_MAX_BYTES, artProxyTarget } from '@/lib/artProxy';
import { jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** GET /api/art?url=: a cover image from YouTube's image hosts, served from
 *  this origin so the page can sample its color (lib/artProxy). Signed-in
 *  members only, allowed hosts only, images only. */
export const GET = withRequestLog('art', async (request: NextRequest) => {
  try {
    await requireUser();
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    throw e;
  }
  const target = artProxyTarget(request.nextUrl.searchParams.get('url'));
  if (!target) return jsonError('not an allowed cover image', 400);
  const res = await fetch(target, { redirect: 'error', signal: AbortSignal.timeout(8000) }).catch(() => null);
  const type = res?.headers.get('content-type') ?? '';
  if (!res?.ok || !type.startsWith('image/')) return jsonError('cover unavailable', 502);
  const body = await res.arrayBuffer();
  if (body.byteLength > ART_MAX_BYTES) return jsonError('cover too large', 502);
  return new Response(body, {
    headers: { 'content-type': type, 'cache-control': 'private, max-age=86400' },
  });
});
