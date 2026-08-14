/** Next's startup hook — runs once when the server boots.
 *  Used to schedule the daily cache/DB cleanup. */
export async function register() {
  // Only the Node server runtime has a filesystem and PocketBase access.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
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
