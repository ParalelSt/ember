import { androidApkAsset } from '@/lib/androidUpdate';
import { fetchAsset } from '@/lib/desktopUpdate';
import { limitCaller } from '@/lib/rateLimit';
import { serverLogger } from '@/lib/logger/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** Streams the latest release's Android APK from GitHub with the host's
 *  token attached, for the phone app's updater (AppUpdater.kt), the same way
 *  /api/desktop/asset/<id> serves the desktop updater.
 *
 *  Public (a signed-out phone must still update), so it serves exactly one
 *  file: the APK of the LATEST published release. Any other id is a 404
 *  before GitHub is asked. The phone checks the package name, versionCode
 *  and signing key before installing, so a swapped file is refused there. */
const MAX_ID = Number.MAX_SAFE_INTEGER;

export const GET = withRequestLog('android/apk/[id]', async (request: Request, ctx: RouteContext<'/api/android/apk/[id]'>) => {
  const { id } = await ctx.params;

  // An APK is tens of MB; a phone downloads it once per release (and once
  // more after a failed verify), so this only stops a loop or a stranger.
  const limited = await limitCaller(request, 'android-apk', {
    windowMs: 60 * 60 * 1000,
    max: 10,
  });
  if (limited) return limited;

  const assetId = Number(id);
  if (!Number.isInteger(assetId) || assetId <= 0 || assetId > MAX_ID) {
    return new Response('bad asset id', { status: 400 });
  }

  const asset = await androidApkAsset(assetId);
  if (!asset) return new Response('asset unavailable', { status: 404 });

  const upstream = await fetchAsset(asset.id);
  if (!upstream || !upstream.ok) {
    serverLogger.error('update', 'apk proxy failed', { assetId, status: upstream?.status });
    return new Response('asset unavailable', { status: 404 });
  }

  const headers = new Headers({
    'Content-Type': 'application/vnd.android.package-archive',
    'Cache-Control': 'no-store',
  });
  const length = upstream.headers.get('content-length');
  if (length) headers.set('Content-Length', length);

  return new Response(upstream.body, { status: 200, headers });
});
