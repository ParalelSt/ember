export interface RankableHit {
  id?: number;
  duration?: number | null;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
  /** True if this hit came from LRCLib's exact-match /api/get endpoint
   *  (stage A in fetchLrclib). Used as a tie-break when duration deltas
   *  are equal. */
  fromStageA?: boolean;
}

const DURATION_CAP_SEC = 10;

/** Pick the single best LRCLib hit across the union of our three
 *  parallel queries. Implements the spec's four-criteria ranking:
 *    1. Has non-empty syncedLyrics — synced beats plain, full stop.
 *    2. Drop instrumentals.
 *    3. Smallest |hit.duration - ourDurationSec|, capped at ±10s.
 *    4. Tie-break on stage-A.
 *  Returns null when no hit qualifies (all instrumental, or empty input). */
export function rankLrclibHits(
  hits: RankableHit[],
  ourDurationSec: number,
): RankableHit | null {
  // Criterion 2: drop instrumentals up front.
  const eligible = hits.filter((h) => !h.instrumental);
  if (eligible.length === 0) return null;

  const hasSync = (h: RankableHit): boolean =>
    !!(h.syncedLyrics && h.syncedLyrics.trim().length > 0);

  // Criterion 1: synced beats plain, so partition.
  const syncedHits = eligible.filter(hasSync);
  const pool = syncedHits.length > 0 ? syncedHits : eligible.filter((h) => !!h.plainLyrics);
  if (pool.length === 0) return null;

  // Criteria 3 + 4: stable sort by (durationDelta ASC, fromStageA DESC).
  // Null/undefined hit.duration → Infinity delta (deprioritized but eligible).
  // ourDurationSec === 0 → skip criterion 3 (we have no reference duration).
  const scored = pool
    .map((h) => {
      const hasOurDur = ourDurationSec > 0;
      const hasHitDur = typeof h.duration === 'number' && Number.isFinite(h.duration);
      const delta = hasOurDur && hasHitDur
        ? Math.abs((h.duration as number) - ourDurationSec)
        : Infinity;
      return { hit: h, delta };
    })
    // Filter out hits beyond the ±10s cap WHEN something closer exists.
    // Mirrors spec: "Cap consideration at ±10s — beyond that the recording
    // is genuinely different and the LRC won't help."
    .filter((s) => s.delta <= DURATION_CAP_SEC || ourDurationSec === 0);

  if (scored.length === 0) {
    // Everything was beyond ±10s. Spec says ourDuration=0 falls back to
    // first synced; we extend that to "nothing within cap" too — return
    // pool[0] so the user still gets lyrics even if timing will be off.
    return pool[0];
  }

  scored.sort((a, b) => {
    if (a.delta !== b.delta) return a.delta - b.delta;
    // Tie: prefer stage-A.
    const aA = a.hit.fromStageA ? 1 : 0;
    const bA = b.hit.fromStageA ? 1 : 0;
    return bA - aA;
  });

  return scored[0].hit;
}
