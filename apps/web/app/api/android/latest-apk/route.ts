import { latestAndroidApk } from '@/lib/androidUpdate';
import { fetchAsset } from '@/lib/desktopUpdate';
import { limitCaller } from '@/lib/rateLimit';
import { serverLogger } from '@/lib/logger/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** The newest Android APK under a short address: /apk (a rewrite in
 *  next.config.ts) lands here. For installing Ember by hand, on a phone or
 *  on a car head unit whose browser nobody signs in to, so it is public
 *  (proxy.ts) like the updater's own APK proxy, and serves only the APK of
 *  Android's current release. Streamed with the host's token attached, under
 *  a file name a browser keeps (Ember-0.4.26.apk) so the download installs
 *  straight from the downloads list. */
export const GET = withRequestLog('android/latest-apk', async (request: Request) => {
  // Someone installs once per device; this only stops a loop or a stranger.
  const limited = await limitCaller(request, 'android-apk-latest', {
    windowMs: 60 * 60 * 1000,
    max: 10,
  });
  if (limited) return limited;

  const latest = await latestAndroidApk();
  if (!latest) return new Response('No Android app is available right now.', { status: 404 });

  const upstream = await fetchAsset(latest.asset.id);
  if (!upstream || !upstream.ok) {
    serverLogger.error('update', 'latest apk proxy failed', { assetId: latest.asset.id, status: upstream?.status });
    return new Response('No Android app is available right now.', { status: 404 });
  }

  const headers = new Headers({
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Disposition': `attachment; filename="Ember-${latest.version}.apk"`,
    'Cache-Control': 'no-store',
  });
  const length = upstream.headers.get('content-length');
  if (length) headers.set('Content-Length', length);

  return new Response(upstream.body, { status: 200, headers });
});
