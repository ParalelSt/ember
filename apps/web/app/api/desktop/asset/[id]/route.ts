import { fetchAsset } from '@/lib/desktopUpdate';
import { keyFromRequest, rateLimitResponse } from '@/lib/rateLimit';
import { serverLogger } from '@/lib/logger/server';

/** Streams a release asset from GitHub with the host's token attached, so the
 *  desktop updater can download from a PRIVATE repo without ever holding a
 *  token itself.
 *
 *  Only numeric asset ids are accepted, and they're passed straight to the
 *  releases endpoint of one fixed repo — there's no path here for a caller to
 *  reach anything else. */
const MAX_ID = Number.MAX_SAFE_INTEGER;

export async function GET(request: Request, ctx: RouteContext<'/api/desktop/asset/[id]'>) {
  const { id } = await ctx.params;

  // Installers are multi-MB; this stops one client (or a bored stranger, since
  // the route is unauthenticated by necessity) pulling them in a loop.
  const limited = rateLimitResponse(`desktop-asset:${keyFromRequest(request)}`, {
    windowMs: 60 * 60 * 1000,
    max: 20,
  });
  if (limited) return limited;

  const assetId = Number(id);
  if (!Number.isInteger(assetId) || assetId <= 0 || assetId > MAX_ID) {
    return new Response('bad asset id', { status: 400 });
  }

  const upstream = await fetchAsset(assetId);
  if (!upstream || !upstream.ok) {
    serverLogger.error('update', 'asset proxy failed', { assetId, status: upstream?.status });
    return new Response('asset unavailable', { status: 404 });
  }

  const headers = new Headers({
    'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  const length = upstream.headers.get('content-length');
  if (length) headers.set('Content-Length', length);

  return new Response(upstream.body, { status: 200, headers });
}
