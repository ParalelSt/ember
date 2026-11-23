/** The host side of the perf kill switch (docs/android-performance.md 5.6):
 *  EMBER_PERF_LOG=off stops the server's request timing, its Server-Timing
 *  headers and every page's perf log (POST /api/perf-log answers
 *  `{ off: true }`). EMBER_PERF_SAMPLE (0 to 1, default 1) is the share of
 *  page sessions that keep it on. Read on every call, so a test can flip it. */

export function perfLogEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.EMBER_PERF_LOG ?? '').trim().toLowerCase();
  return v !== 'off' && v !== '0' && v !== 'false';
}

export function perfSample(env: Record<string, string | undefined> = process.env): number {
  const raw = env.EMBER_PERF_SAMPLE;
  if (raw === undefined || raw.trim() === '') return 1;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}
