import { latestReleaseWithin } from '@/lib/desktopUpdate';
import { cleanVersion } from '@/lib/androidUpdate';
import { serverLogger } from '@/lib/logger/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { publicOrigin } from '@/lib/publicOrigin';
import { clientIp, rateLimitResponse } from '@/lib/rateLimit';
import { CHECK_AFTER_S, decideUpdate, isInstallKind, isPlatform, type AppUpdateAnswer } from '@/lib/updatePolicy';

/** The launch gate's question, shared by every native shell:
 *
 *    GET /api/app/update?platform=windows|macos|linux|android|ios|web
 *                       &version=0.4.21[&arch=x86_64|aarch64]
 *                       [&install=nsis|msi|appimage|deb|rpm|app|apk|testflight]
 *                       [&launch=1]
 *
 *  Always 200 with `{ platform, current, latest, minVersion, update,
 *  checkAfter }` (lib/updatePolicy.ts); `update: null` means "open the app".
 *  400 only for a malformed platform or version, 429 past the rate limit
 *  (the shells treat both as "no update"), never 5xx.
 *
 *  It has to answer within the gate's budget (1.5 s on desktop, 2 s on a
 *  phone), so it never waits on GitHub for long: the release comes from the
 *  shared cache, and a cold cache that takes longer than WAIT_MS answers
 *  `unavailable: true` while the lookup carries on for the next launch.
 *
 *  Public, like the existing feeds: a signed-out shell must still update.
 *  It tells nobody anything but the latest version. The actual downloads
 *  stay on /api/desktop/update + /api/desktop/asset and /api/android/update
 *  + /api/android/apk. */
const WAIT_MS = Number(process.env.UPDATE_GATE_WAIT_MS ?? 700);
/** Per address: a whole household of shells launching all day stays far
 *  below it. */
const APP_UPDATE_LIMIT = { windowMs: 60 * 60 * 1000, max: 120 };

export const GET = withRequestLog('app/update', async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const platform = params.get('platform');
  const current = cleanVersion(params.get('version'));
  if (!isPlatform(platform) || !current) {
    return Response.json({ error: 'platform and version=x.y.z are required' }, { status: 400 });
  }
  const rawInstall = params.get('install');
  const install = isInstallKind(rawInstall) ? rawInstall : null;
  const rawArch = (params.get('arch') ?? '').trim().toLowerCase();
  const arch = /^[a-z0-9_]{1,16}$/.test(rawArch) ? rawArch : null;
  const launch = params.get('launch') === '1';

  const limited = rateLimitResponse(`app-update:${clientIp(request)}`, APP_UPDATE_LIMIT);
  if (limited) return limited;

  let answer: AppUpdateAnswer;
  try {
    const release = await latestReleaseWithin(WAIT_MS);
    const errors: string[] = [];
    answer = decideUpdate({
      release: release ?? null,
      platform,
      install,
      arch,
      current,
      origin: publicOrigin(request),
      errors,
    });
    if (release === undefined && !answer.paused) answer.unavailable = true;
    for (const e of errors) serverLogger.error('update', e, { platform, install });
  } catch (e) {
    serverLogger.error('update', 'app update check failed', { platform, current }, e);
    answer = { platform, current, latest: null, minVersion: null, update: null, checkAfter: CHECK_AFTER_S, unavailable: true };
  }

  // One line per check: adoption per version and platform, with no work on
  // the shells' side.
  serverLogger.info('update', 'update.check', {
    platform,
    install,
    current,
    latest: answer.latest,
    launch,
    result: answer.paused ? 'paused' : answer.unavailable ? 'unavailable' : answer.update ? (answer.update.mandatory ? 'mandatory' : 'update') : 'none',
  });
  return Response.json(answer, { headers: { 'Cache-Control': 'no-store' } });
});
