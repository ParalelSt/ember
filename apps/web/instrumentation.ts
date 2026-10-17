/** Next's startup hook: runs once when the server boots. Installs the
 *  uncaught-error catch, starts the playlist import runner, and schedules
 *  the daily cache/DB cleanup, the daily error digest, the nightly genre
 *  mix build and the prank tick. */
export async function register() {
  // Only the Node server runtime has a filesystem and PocketBase access.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Before the cleanup opt-out below: a server with cleanup disabled still
  // needs its crashes logged and reported.
  const { installCrashHandlers, spawnCrashReport } = await import('@/lib/crashHandlers');
  const { serverLogger } = await import('@/lib/logger/server');
  installCrashHandlers({
    log: serverLogger.error,
    spawnReport: spawnCrashReport,
  });

  // Start/stop record and heartbeat (lib/serverLife.ts), so an outage and its
  // length show up in the digest. Never allowed to stop the boot.
  try {
    const { startServerLife } = await import('@/lib/serverLife');
    const { logDir } = await import('@/lib/logger/server');
    let version = 'unknown';
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      version = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).version ?? version;
    } catch {
      // Version is a nicety.
    }
    await startServerLife({
      dir: logDir(),
      version,
      log: {
        info: serverLogger.info,
        warn: serverLogger.warn,
        infoSync: serverLogger.infoSync,
      },
    });
  } catch (e) {
    console.warn('[serverLife] could not start', e);
  }

  // yt-dlp self-update (lib/ytdlp): once a day, and sooner after a run of
  // YouTube 403s (the stream route reports those). YTDLP_AUTO_UPGRADE=0 opts out.
  const { upgradeEnabled } = await import('@/lib/ytdlp/upgradePolicy');
  if (upgradeEnabled()) {
    const { ytdlpUpgradeJob } = await import('@/lib/ytdlp/upgradeRunner');
    const job = ytdlpUpgradeJob();
    // Checked every 30 minutes (the marker file keeps it to once a day across
    // restarts); the first look is 5 minutes after boot.
    const first = setTimeout(() => void job.tick().catch(() => {}), 5 * 60 * 1000);
    first.unref?.();
    const upgradeTimer = setInterval(() => void job.tick().catch(() => {}), 30 * 60 * 1000);
    upgradeTimer.unref?.();
  }

  // Ahead of the CLEANUP_DISABLED guard below: the missing-key warning
  // must fire on every boot, including sandboxes and tests that disable
  // cleanup, not just deployments that run the daily job.
  const { checkTriageConfig } = await import('@/lib/ai/triage');
  checkTriageConfig();

  // Ahead of the CLEANUP_DISABLED guard too: the digest is its own job with
  // its own switch, not part of the cleanup run. Opt in rather than out: the
  // webhook falls back to the one baked into the app, so a default-on digest
  // would have every self-hosted copy posting into its owner's channel daily.
  if (process.env.DIGEST_ENABLED === '1') {
    const { digestHour, markerExists, runDigest, shouldRunNow } = await import('@/lib/reports/digestJob');
    const hour = digestHour();
    const tick = async () => {
      try {
        const now = new Date();
        if (!shouldRunNow(now, hour, await markerExists(now))) return;
        await runDigest({ now: now.getTime(), writeMarker: true });
      } catch (e) {
        // Never let the digest take the server down.
        console.warn('[digest] scheduled run failed', e);
      }
    };
    // Checked every minute rather than scheduled once: a host that was
    // asleep or restarting at DIGEST_HOUR still sends the day's digest when
    // it comes back, and the marker file keeps that to once a day.
    const digest = setInterval(() => void tick(), 60 * 1000);
    digest.unref?.();
  }

  // Genre mixes (docs/mixes.md): rebuilt for every member who played
  // something lately, once a night at MIXES_HOUR (default 4), checked every
  // minute with a marker file like the digest. MIXES_DISABLED=1 opts out
  // (the lazy rebuild from GET /api/mixes too).
  if (process.env.MIXES_DISABLED !== '1') {
    const { createNightlyTick, mixesHour } = await import('@/lib/mixes/schedule');
    const { MUSIC_DIR } = await import('@/lib/sources/youtube');
    const tick = createNightlyTick({
      dir: MUSIC_DIR,
      hour: mixesHour(),
      build: async () => {
        const { mixJob } = await import('@/lib/mixes/instance');
        await mixJob().runAll();
      },
      warn: (message, detail) => serverLogger.warn('mixes', message, detail),
    });
    const nightly = setInterval(() => void tick().catch(() => {}), 60 * 1000);
    nightly.unref?.();
  }

  // The release lookup behind the update feeds, filled now so the first
  // launch gate after a restart is answered from memory instead of waiting
  // on GitHub (lib/desktopUpdate.ts). Does nothing without a token.
  if (process.env.UPDATE_WARMUP_DISABLED !== '1') {
    const { warmReleaseCache } = await import('@/lib/desktopUpdate');
    warmReleaseCache();
  }

  // Background playlist imports (docs/imports.md): one runner per server,
  // picking up where it stopped if the server went down mid-import.
  if (process.env.IMPORT_RUNNER_DISABLED !== '1') {
    const { startImportRunner } = await import('@/lib/import/runnerInstance');
    startImportRunner();
  }

  // Repeating prank sounds (lib/pranks/scheduler.ts): a 5 s tick that turns
  // due schedules into pranks. The global switch is checked on every tick.
  if (process.env.PRANK_TICK_DISABLED !== '1') {
    const { startPrankTick } = await import('@/lib/pranks/schedulerInstance');
    startPrankTick();
  }

  if (process.env.CLEANUP_DISABLED === '1') return;

  const { createAdminClient } = await import('@/lib/pocketbase/server');
  const { runCleanup } = await import('@/lib/cleanup');

  const DAY_MS = 24 * 60 * 60 * 1000;
  const run = async () => {
    try {
      const pb = await createAdminClient();
      await runCleanup(pb);
    } catch (e) {
      // Never let a failed cleanup take the server down.
      console.warn('[cleanup] scheduled run failed', e);
    }
  };

  // Wait an hour after boot so a restart never competes with someone pressing
  // play, then run daily. unref() keeps the timer from holding the process open.
  const first = setTimeout(() => {
    void run();
    const daily = setInterval(() => void run(), DAY_MS);
    daily.unref?.();
  }, 60 * 60 * 1000);
  first.unref?.();
}
