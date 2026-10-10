import { updateFor } from '@/lib/desktopUpdate';
import { isLoopback, publicOrigin } from '@/lib/publicOrigin';
import { serverLogger } from '@/lib/logger/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { isPaused, platformOfTarget } from '@/lib/updatePolicy';

/** Tauri's update feed. The desktop app is configured (tauri.conf.json) to
 *  call /api/desktop/update/{{target}}/{{arch}}/{{current_version}}.
 *
 *  204 means "you're up to date", that's the contract, not an error, and it's
 *  also what every failure degrades to. A broken update check must never stop
 *  someone playing music, so nothing here returns 5xx.
 *
 *  Public by necessity: the updater runs in Rust with no browser session. It
 *  exposes only "what's the latest version" plus a proxied installer download,
 *  never user data.
 *
 *  `?bundle={{bundle_type}}` (nsis, msi, appimage, deb, rpm, app) picks the
 *  file for how the app was installed; without it (apps from before the
 *  launch gate) the answer is what it always was. EMBER_UPDATES_PAUSED
 *  covering the platform makes this a 204 like any "no update". */
export const GET = withRequestLog('desktop/update/[target]/[arch]/[current]', async (_request: Request, ctx: RouteContext<'/api/desktop/update/[target]/[arch]/[current]'>) => {
  try {
    const { target, arch, current } = await ctx.params;
    const platform = platformOfTarget(target);
    if (platform && isPaused(platform)) return new Response(null, { status: 204 });
    const bundle = new URL(_request.url).searchParams.get('bundle');
    // Must be the origin the APP can reach, not the one this process was
    // addressed on: behind a tunnel those differ, and the difference lands in
    // the installer download URL.
    const origin = publicOrigin(_request);
    if (isLoopback(origin)) {
      serverLogger.error('update', 'update feed built a loopback download URL, set PUBLIC_ORIGIN', { origin });
    }

    const manifest = await updateFor(target, arch, current, origin, bundle);
    if (!manifest) return new Response(null, { status: 204 });

    return Response.json(manifest);
  } catch (e) {
    serverLogger.error('update', 'feed failed', undefined, e);
    return new Response(null, { status: 204 });
  }
});
