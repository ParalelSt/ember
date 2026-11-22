import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { ART_MAX_BYTES, artProxyTarget } from '@/lib/artProxy';
import { jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** Raster cover formats only. An SVG is a document that can carry script,
 *  and served from this origin it would run as the app (googleusercontent
 *  hosts files anyone can upload). */
const RASTER = /^image\/(jpeg|png|webp|gif|avif)$/;

/** The body, or null once it passes `max` bytes: read in chunks so an
 *  oversized file is dropped as soon as it is too big, never held whole. */
async function readCapped(res: Response, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(res.headers.get('content-length') ?? 0) > max) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

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
  let body: Uint8Array<ArrayBuffer> | null;
  try {
    body = await readCapped(res, ART_MAX_BYTES);
  } catch {
    return jsonError('cover unavailable', 502);
  }
  if (!body) return jsonError('cover too large', 502);
  return new Response(body, {
    headers: {
      'content-type': type,
      'cache-control': 'private, max-age=86400',
      'x-content-type-options': 'nosniff',
    },
  });
});
