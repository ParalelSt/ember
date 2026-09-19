/** Next's startup hook: runs once when the server boots. Installs the
 *  uncaught-error catch, starts the playlist import runner, and schedules
 *  the daily cache/DB cleanup and the daily error digest. */
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

  // Background playlist imports (docs/imports.md): one runner per server,
  // picking up where it stopped if the server went down mid-import.
  if (process.env.IMPORT_RUNNER_DISABLED !== '1') {
    const { startImportRunner } = await import('@/lib/import/runnerInstance');
    startImportRunner();
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
