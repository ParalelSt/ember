import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { ART_MAX_BYTES, artProxyTarget } from '@/lib/artProxy';
import { jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** Raster cover formats only. An SVG is a document that can carry script,
 *  and served from this origin it would run as the app (googleusercontent
 *  hosts files anyone can upload). */
const RASTER = /^image\/(jpeg|png|webp|gif|avif)$/;

/** GET /api/art?url=: a cover image from YouTube's image hosts, served from
 *  this origin so the page can sample its color (lib/artProxy). Signed-in
 *  members only, allowed hosts only, raster images only. */
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
  const type = (res?.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!res?.ok || !RASTER.test(type)) return jsonError('cover unavailable', 502);
  const body = await res.arrayBuffer();
  if (body.byteLength > ART_MAX_BYTES) return jsonError('cover too large', 502);
  return new Response(body, {
    headers: {
      'content-type': type,
      'cache-control': 'private, max-age=86400',
      'x-content-type-options': 'nosniff',
    },
  });
});
