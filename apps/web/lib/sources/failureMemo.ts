/** What the host has recently learned about a video it could not play, so
 *  the same question is not put to yt-dlp again and again.
 *
 *  Before this, nothing remembered a failure: a radio song YouTube had taken
 *  down was downloaded by the auto cache's prefetch, again by the real play,
 *  and again by every retry the player made (the Android player retries a
 *  failed request by itself), each run a few seconds of yt-dlp ending in the
 *  same "This video is not available". The database flag (lib/
 *  trackAvailability) only exists for songs somebody has saved, and radio
 *  songs mostly are not, so the host keeps its own short memory here too.
 *
 *  Two kinds, remembered for different lengths of time:
 *  - unavailable: YouTube says the video is gone (removed, private, geo,
 *    members only, channel closed, age-restricted for a host that never
 *    signs in). Hours: it will not come back by itself
 *    in the next few minutes, and a play that finds it on disk (or a
 *    successful download) forgets it at once.
 *  - transient: nothing could serve it right now (yt-dlp 403, a stall, a
 *    timeout). Two minutes, so a player retrying straight away gets the same
 *    answer at once instead of waiting through another failure, while the
 *    listener pressing play again a little later still gets a real attempt.
 *
 *  In memory only, per process: a restart forgets, which costs one more try.
 *  Pure (no server imports), so it tests without a host. */

/** The UnavailableReason codes of lib/sources/youtube, repeated here so this
 *  module does not import a server-only file. */
export type MemoReason = 'removed' | 'private' | 'geo' | 'members' | 'terminated' | 'age' | 'unavailable';

export type KnownFailure =
  | { kind: 'unavailable'; reason: MemoReason; message: string; until: number }
  | { kind: 'transient'; message: string; until: number };

export const UNAVAILABLE_MEMO_MS = 6 * 60 * 60 * 1000;
export const TRANSIENT_MEMO_MS = 2 * 60 * 1000;
/** A bound, so a flood of distinct ids can never grow this without limit. */
const MAX_ENTRIES = 2000;

/** One memory per server PROCESS, not per module copy: a production build
 *  bundles each route on its own, so a plain module-level Map gave the
 *  stream route, the availability check and radio three separate memories
 *  (found live: the stream route knew a song was gone, the availability
 *  check said it was fine). */
const GLOBAL_KEY = Symbol.for('ember.failureMemo');
const memo: Map<string, KnownFailure> = ((globalThis as Record<symbol, unknown>)[GLOBAL_KEY] ??= new Map()) as Map<string, KnownFailure>;

function put(videoId: string, entry: KnownFailure): void {
  memo.delete(videoId);
  if (memo.size >= MAX_ENTRIES) {
    // Oldest insertion first (Map order): the one closest to expiring anyway.
    const oldest = memo.keys().next().value;
    if (oldest !== undefined) memo.delete(oldest);
  }
  memo.set(videoId, entry);
}

export function rememberUnavailable(videoId: string, reason: MemoReason, message: string, now = Date.now()): void {
  put(videoId, { kind: 'unavailable', reason, message, until: now + UNAVAILABLE_MEMO_MS });
}

/** A transient failure never overwrites a known unavailable one: "gone" is
 *  the stronger, more useful answer. */
export function rememberTransient(videoId: string, message: string, now = Date.now()): void {
  const known = recentFailure(videoId, now);
  if (known?.kind === 'unavailable') return;
  put(videoId, { kind: 'transient', message, until: now + TRANSIENT_MEMO_MS });
}

export function recentFailure(videoId: string, now = Date.now()): KnownFailure | null {
  const entry = memo.get(videoId);
  if (!entry) return null;
  if (entry.until <= now) {
    memo.delete(videoId);
    return null;
  }
  return entry;
}

/** The video played (or downloaded) after all. */
export function forgetFailure(videoId: string): void {
  memo.delete(videoId);
}

/** Track ids (`youtube:<videoId>`) currently remembered as unavailable, for
 *  filtering radio and recommendations. */
export function unavailableTrackIds(now = Date.now()): Set<string> {
  const ids = new Set<string>();
  for (const [videoId, entry] of memo) {
    if (entry.kind === 'unavailable' && entry.until > now) ids.add(`youtube:${videoId}`);
  }
  return ids;
}

/** Tests only. */
export function _resetFailureMemo(): void {
  memo.clear();
}
