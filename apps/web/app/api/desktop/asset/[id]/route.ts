import { fetchAsset, updaterAsset } from '@/lib/desktopUpdate';
import { limitCaller } from '@/lib/rateLimit';
import { serverLogger } from '@/lib/logger/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** Streams a release asset from GitHub with the host's token attached, so the
 *  desktop updater can download from a PRIVATE repo without ever holding a
 *  token itself.
 *
 *  Public (the updater has no session), so it serves exactly what the
 *  updater needs and nothing else: an asset of the LATEST published release
 *  whose name is an update bundle, its .sig or latest.json. Any other id, an
 *  older release's, a draft's, a hand-download installer's, is a 404 before
 *  GitHub is asked (security audit 2026-09-25, M3). */
const MAX_ID = Number.MAX_SAFE_INTEGER;

export const GET = withRequestLog('desktop/asset/[id]', async (request: Request, ctx: RouteContext<'/api/desktop/asset/[id]'>) => {
  const { id } = await ctx.params;

  // Installers are multi-MB; this stops one client (or a bored stranger, since
  // the route is unauthenticated by necessity) pulling them in a loop.
  const limited = await limitCaller(request, 'desktop-asset', {
    windowMs: 60 * 60 * 1000,
    max: 20,
  });
  if (limited) return limited;

  const assetId = Number(id);
  if (!Number.isInteger(assetId) || assetId <= 0 || assetId > MAX_ID) {
    return new Response('bad asset id', { status: 400 });
  }

  const asset = await updaterAsset(assetId);
  if (!asset) return new Response('asset unavailable', { status: 404 });

  const upstream = await fetchAsset(asset.id);
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
});
