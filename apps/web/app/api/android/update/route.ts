import { androidUpdateFor, cleanVersion } from '@/lib/androidUpdate';
import { serverLogger } from '@/lib/logger/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** The Android app's update feed (AppUpdater.kt):
 *  GET /api/android/update?version=0.4.18[&versionCode=23]
 *
 *  200 with { version, versionCode, url, size, sha256, notes, publishedAt }
 *  when the latest release is newer; 204 when the phone is up to date, and
 *  also when anything fails (like the desktop feed, a broken check must
 *  never get in the way of music). 400 only for a missing or malformed
 *  version, which is a bug in the app, not a state to retry.
 *
 *  Public, like the desktop feed: a signed-out phone still has to be able to
 *  update (the fix for a sign-in bug arrives this way). It tells nobody
 *  anything but the latest version. versionCode is accepted for the logs and
 *  for the future; the comparison is by version, since a release does not
 *  carry its versionCode. */
export const GET = withRequestLog('android/update', async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const current = cleanVersion(params.get('version'));
  if (!current) return Response.json({ error: 'version=x.y.z is required' }, { status: 400 });

  try {
    const update = await androidUpdateFor(current);
    if (!update) return new Response(null, { status: 204 });
    return Response.json(update, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    serverLogger.error('update', 'android feed failed', { current }, e);
    return new Response(null, { status: 204 });
  }
});
