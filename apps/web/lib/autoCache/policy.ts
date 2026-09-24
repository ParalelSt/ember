import type { PlaybackContext } from '../../types/track';
import { isUnavailable, nextIndex, nextPlayable, type QueueNavState } from '../playback/queueNav';

/** Auto cache prefetch policy: WHAT should be on disk (the current track and
 *  the next N playable ones) and WHEN one more download may start. Pure (no
 *  store, no DOM, no clock of its own) so the web and desktop drivers share it
 *  as is and the Android Kotlin mirror can be checked against the same case
 *  table (`policy.cases.json`). The contract is spelled out in README.md next
 *  to this file; change both, and the table, together. */

export interface PolicyTrack {
  id: string;
  unavailableAt?: string | null;
  streamUrl?: string | null;
}

export type IdleReason =
  | 'disabled'
  | 'offline'
  | 'metered'
  | 'battery'
  | 'not-settled'
  | 'busy'
  | 'cap'
  | 'nothing'
  | 'backoff';

export interface PolicyInput {
  queue: readonly PolicyTrack[];
  index: number;
  loopMode: 'off' | 'all' | 'one';
  /** Only `type` is read (by wrapPoint). */
  context: { type: string } | null;
  baseCount: number;
  /** Current track state from the player. */
  playedSec: number;
  /** null = the platform cannot tell. */
  bufferedToEnd: boolean | null;
  /** Informational: a paused, fully buffered track is a fine moment to
   *  prefetch, so the policy does not gate on this. */
  playing: boolean;
  /** Device conditions. */
  online: boolean;
  /** null = unknown, treated as not metered. */
  metered: boolean | null;
  saveData: boolean;
  batterySaver: boolean;
  /** Settings. */
  enabled: boolean;
  allowMetered: boolean;
  /** Whether the current track should be downloaded too. True on web (the
   *  audio element does not write through to our cache); false on Android
   *  (SimpleCache writes through) and desktop (the stream temp file holds it). */
  requestCurrent: boolean;
  /** Cache state. */
  cached: ReadonlySet<string>;
  inFlight: string | null;
  /** Total bytes the auto cache holds right now. */
  bytes: number;
  cap: number;
  /** Bytes on disk per cached id. Lets the size check count what eviction
   *  could free; ids missing here count as 0 reclaimable bytes. */
  sizes?: ReadonlyMap<string, number>;
  /** Expected download size per id; missing = POLICY.EXPECTED_BYTES_DEFAULT. */
  expectedBytes?: ReadonlyMap<string, number>;
  /** Backoff ledger: id -> earliest ms to try again (fake clock in tests). */
  backoffUntil: ReadonlyMap<string, number>;
  attempts: ReadonlyMap<string, number>;
  nowMs: number;
}

export const POLICY = {
  N: 2,
  MIN_PLAYED_SEC: 15,
  BUFFER_FALLBACK_SEC: 45,
  MAX_ATTEMPTS: 3,
  BACKOFF_SEC: [15, 30, 60, 120],
  RETRY_AFTER_CAP_SEC: 120,
  /** A 503 without a usable Retry-After waits what the server would have said. */
  BUSY_DEFAULT_SEC: 30,
  /** 6 MiB: a long song at m4a 128 kbps, so an unknown size errs on the big side. */
  EXPECTED_BYTES_DEFAULT: 6 * 1024 * 1024,
} as const;

export type PolicyAction =
  | { kind: 'start'; id: string }
  /** The in-flight id left the window (skip, queue edit): cancel it. */
  | { kind: 'abort'; id: string }
  /** `wakeAtMs` only with reason 'backoff': the earliest moment a skipped id
   *  becomes eligible again, so the driver can set one timer. */
  | { kind: 'idle'; reason: IdleReason; wakeAtMs?: number };

export type FetchResult =
  | { kind: 'done'; bytes: number }
  | { kind: 'retry-after'; status: 429 | 503; seconds: number | null }
  /** 410: the server has flagged the track unavailable. */
  | { kind: 'gone' }
  | { kind: 'failed' };

export interface Ledger {
  backoffUntil: Map<string, number>;
  attempts: Map<string, number>;
  /** True when the id is out for this session (410, or attempts exhausted).
   *  The ledger already records it as exhausted, so feeding the returned maps
   *  back in keeps it out without any extra state. */
  drop: boolean;
}

function streamable(t: PolicyTrack | undefined): t is PolicyTrack {
  return !!t && !!t.id && !!t.streamUrl && !isUnavailable(t);
}

function navState(input: PolicyInput, index: number): QueueNavState {
  return {
    queue: input.queue,
    index,
    loopMode: input.loopMode,
    // wrapPoint only reads `type`, which is all the policy carries.
    context: input.context as PlaybackContext | null,
    baseCount: input.baseCount,
  };
}

/** Ids that should be on disk, in priority order: current first (when it can
 *  be streamed), then the next N playable. Walks exactly like the player's
 *  Next: `nextIndex`, then `nextPlayable` (wrapping under loop-all) past
 *  unavailable tracks. Tracks without a streamUrl are passed over and do not
 *  use a slot. Shuffle is already physical in the queue, so index order is
 *  play order. */
export function desiredIds(input: PolicyInput): string[] {
  const { queue, index } = input;
  if (index < 0 || index >= queue.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const cur = queue[index];
  if (streamable(cur)) {
    out.push(cur.id);
    seen.add(cur.id);
  }
  const wrap = input.loopMode === 'all';
  // Landing on an index twice means loop-all has come round: stop there, or a
  // queue of dead, duplicate or unstreamable tracks would cycle (and rescan)
  // forever. This keeps the walk linear in the queue length.
  const landed = new Set<number>([index]);
  let at = index;
  let found = 0;
  while (found < POLICY.N) {
    const move = nextIndex(navState(input, at));
    if (!move) break;
    const r = nextPlayable(queue, move.index, 1, wrap);
    if (r.index < 0 || landed.has(r.index)) break;
    landed.add(r.index);
    at = r.index;
    const t = queue[at];
    if (!streamable(t) || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t.id);
    found++;
  }
  return out;
}

/** Ids that must never be evicted: the current track (even one that cannot
 *  be streamed, it may still be playing from cache) and the window. */
function protectedIds(input: PolicyInput, window: readonly string[]): Set<string> {
  const keep = new Set(window);
  const cur = input.queue[input.index];
  if (cur?.id) keep.add(cur.id);
  return keep;
}

function reclaimableBytes(input: PolicyInput, keep: ReadonlySet<string>): number {
  if (!input.sizes) return 0;
  let free = 0;
  for (const id of input.cached) {
    if (!keep.has(id)) free += Math.max(0, input.sizes.get(id) ?? 0);
  }
  return free;
}

function expectedFor(input: PolicyInput, id: string): number {
  const e = input.expectedBytes?.get(id);
  return e !== undefined && Number.isFinite(e) && e >= 0 ? e : POLICY.EXPECTED_BYTES_DEFAULT;
}

/** The single step to take now. Checks run in a fixed order and the first
 *  that applies wins, so every platform reports the same reason. */
export function nextAction(input: PolicyInput): PolicyAction {
  if (!input.enabled) return { kind: 'idle', reason: 'disabled' };
  if (!input.online) return { kind: 'idle', reason: 'offline' };
  if (input.batterySaver) return { kind: 'idle', reason: 'battery' };
  // Save-data is the device owner asking every app to hold back, so it wins
  // over our own "also on mobile data" toggle.
  if (input.saveData) return { kind: 'idle', reason: 'metered' };
  if (input.metered === true && !input.allowMetered) return { kind: 'idle', reason: 'metered' };

  const window = desiredIds(input);
  if (input.inFlight !== null) {
    return window.includes(input.inFlight)
      ? { kind: 'idle', reason: 'busy' }
      : { kind: 'abort', id: input.inFlight };
  }

  // `!(x >= y)` so a NaN from a confused player reads as not settled.
  const played = input.playedSec;
  if (
    !(played >= POLICY.MIN_PLAYED_SEC) ||
    input.bufferedToEnd === false ||
    (input.bufferedToEnd === null && !(played >= POLICY.BUFFER_FALLBACK_SEC))
  ) {
    return { kind: 'idle', reason: 'not-settled' };
  }

  const cur = input.queue[input.index];
  const skipCurrent = !input.requestCurrent && cur ? cur.id : null;
  const room = input.cap - input.bytes + reclaimableBytes(input, protectedIds(input, window));
  let wakeAtMs: number | null = null;
  let sizeSkipped = false;
  for (const id of window) {
    if (id === skipCurrent || input.cached.has(id)) continue;
    if ((input.attempts.get(id) ?? 0) >= POLICY.MAX_ATTEMPTS) continue;
    const until = input.backoffUntil.get(id);
    if (until !== undefined && until > input.nowMs) {
      wakeAtMs = wakeAtMs === null ? until : Math.min(wakeAtMs, until);
      continue;
    }
    if (expectedFor(input, id) > room) {
      sizeSkipped = true;
      continue;
    }
    return { kind: 'start', id };
  }
  // A backoff ends by itself, a full cache only when the window moves, so
  // backoff is the more useful answer when both held something back.
  if (wakeAtMs !== null) return { kind: 'idle', reason: 'backoff', wakeAtMs };
  if (sizeSkipped) return { kind: 'idle', reason: 'cap' };
  return { kind: 'idle', reason: 'nothing' };
}

/** Ledger update after a server answer for `id`. Every answer except `done`
 *  uses one attempt; the attempt that reaches MAX_ATTEMPTS drops the id.
 *  Returns fresh maps; the input is never mutated. */
export function onResult(input: PolicyInput, id: string, result: FetchResult): Ledger {
  const backoffUntil = new Map(input.backoffUntil);
  const attempts = new Map(input.attempts);

  if (result.kind === 'done') {
    backoffUntil.delete(id);
    attempts.delete(id);
    return { backoffUntil, attempts, drop: false };
  }
  if (result.kind === 'gone') {
    backoffUntil.delete(id);
    attempts.set(id, POLICY.MAX_ATTEMPTS);
    return { backoffUntil, attempts, drop: true };
  }

  const n = (attempts.get(id) ?? 0) + 1;
  attempts.set(id, n);
  const scheduled = POLICY.BACKOFF_SEC[Math.min(n, POLICY.BACKOFF_SEC.length) - 1];
  let waitSec: number = scheduled;
  if (result.kind === 'retry-after') {
    const s = result.seconds;
    if (s !== null && Number.isFinite(s) && s >= 0) {
      waitSec = Math.min(s, POLICY.RETRY_AFTER_CAP_SEC);
    } else if (result.status === 503) {
      waitSec = POLICY.BUSY_DEFAULT_SEC;
    }
  }
  backoffUntil.set(id, input.nowMs + waitSec * 1000);
  return { backoffUntil, attempts, drop: n >= POLICY.MAX_ATTEMPTS };
}

/** Cached ids that may be evicted, least recently used first. Never the
 *  current track or the window. An id with no lastUsed entry counts as the
 *  oldest; ties break by id so every platform evicts in the same order. */
export function evictionOrder(input: PolicyInput, lastUsed: ReadonlyMap<string, number>): string[] {
  const keep = protectedIds(input, desiredIds(input));
  const candidates: string[] = [];
  for (const id of input.cached) if (!keep.has(id)) candidates.push(id);
  const age = (id: string) => lastUsed.get(id) ?? Number.NEGATIVE_INFINITY;
  return candidates.sort((a, b) => {
    const d = age(a) - age(b);
    if (d !== 0 && !Number.isNaN(d)) return d;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/** What to delete before writing `incomingBytes`: the shortest prefix of
 *  `evictionOrder` that gets `bytes + incomingBytes <= cap`. `fits: false`
 *  means even evicting every candidate is not enough; the driver should then
 *  delete nothing and skip the write. Sizes come from `input.sizes`. */
export function evictToFit(
  input: PolicyInput,
  lastUsed: ReadonlyMap<string, number>,
  incomingBytes: number,
): { evict: string[]; fits: boolean } {
  let bytes = input.bytes;
  if (bytes + incomingBytes <= input.cap) return { evict: [], fits: true };
  const evict: string[] = [];
  for (const id of evictionOrder(input, lastUsed)) {
    evict.push(id);
    bytes -= Math.max(0, input.sizes?.get(id) ?? 0);
    if (bytes + incomingBytes <= input.cap) return { evict, fits: true };
  }
  return { evict: [], fits: false };
}
