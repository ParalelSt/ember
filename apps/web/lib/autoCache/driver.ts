import type { PlaybackContext, Track } from '../../types/track';
import type { CacheAdapter } from './adapter';
import type { Conditions } from './conditions';
import {
  POLICY,
  evictToFit,
  nextAction,
  onResult,
  type FetchResult,
  type PolicyAction,
  type PolicyInput,
} from './policy';

/** Runs the prefetch policy against one CacheAdapter: builds the policy
 *  input from the player and the device, starts at most one download, keeps
 *  the backoff ledger, evicts before each write, and re-evaluates after every
 *  answer. Framework-free; hooks/player/useAutoCache wires it to React and
 *  the stores, and decides when to call `tick`. */

export interface PlayerSnapshot {
  queue: readonly Track[];
  index: number;
  loopMode: 'off' | 'all' | 'one';
  context: PlaybackContext | { type: string } | null;
  baseCount: number;
  playing: boolean;
}

export interface PlaybackSnapshot {
  /** Seconds into the current track. */
  playedSec: number;
  /** AudioBackend.getBufferedToEnd; null = the engine cannot tell. */
  bufferedToEnd: boolean | null;
}

/** Test-only thresholds (the sandbox browser test seeds them), mapped onto
 *  the policy's fixed ones: see `effectivePlayedSec`. */
export interface TestOverrides {
  minPlayedSec: number;
  bufferFallbackSec: number;
}

export interface DriverDeps {
  adapter: CacheAdapter;
  player: () => PlayerSnapshot;
  playback: () => PlaybackSnapshot;
  conditions: () => Conditions;
  settings: () => { enabled: boolean; allowMetered: boolean };
  overrides?: TestOverrides | null;
  now?: () => number;
  /** The adapter's contents changed (a download landed, something was evicted). */
  onCacheChange?: () => void;
  onInFlight?: (id: string | null) => void;
  log?: (event: string, data: Record<string, unknown>) => void;
}

export interface AutoCacheDriver {
  /** Re-evaluate now. Cheap; safe to call on every state change. */
  tick(): void;
  /** A track started playing: bump its last-used time, then tick. */
  trackStarted(id: string): void;
  /** Stop the download in flight, if any, without costing it an attempt. */
  cancel(): void;
  /** The last decision, for tests and logs. */
  lastAction(): PolicyAction | null;
  dispose(): void;
}

/** 160 kbps, the top of what the host's m4a/opus downloads run at, so an
 *  estimate errs on the big side like the policy's default does. */
const BYTES_PER_SEC = 20_000;

export function expectedBytesFor(track: Pick<Track, 'durationSec'> | undefined): number | undefined {
  const d = track?.durationSec ?? 0;
  return d > 0 ? Math.ceil(d * BYTES_PER_SEC) : undefined;
}

/** The policy's gates are fixed at MIN_PLAYED_SEC and BUFFER_FALLBACK_SEC.
 *  Test overrides move them by reporting the playhead as the value that
 *  lands on the same side of each gate. */
export function effectivePlayedSec(played: number, o: TestOverrides | null | undefined): number {
  if (!o) return played;
  if (!(played >= o.minPlayedSec)) return 0;
  if (!(played >= o.bufferFallbackSec)) return POLICY.MIN_PLAYED_SEC;
  return Math.max(played, POLICY.BUFFER_FALLBACK_SEC);
}

export function createAutoCacheDriver(deps: DriverDeps): AutoCacheDriver {
  const { adapter } = deps;
  const now = deps.now ?? Date.now;
  let backoffUntil: ReadonlyMap<string, number> = new Map();
  let attempts: ReadonlyMap<string, number> = new Map();
  let inFlight: { id: string; controller: AbortController } | null = null;
  let wakeTimer: ReturnType<typeof setTimeout> | null = null;
  let last: PolicyAction | null = null;
  let disposed = false;

  const log = (event: string, data: Record<string, unknown>) => deps.log?.(event, data);

  function buildInput(): PolicyInput {
    const p = deps.player();
    const pb = deps.playback();
    const c = deps.conditions();
    const s = deps.settings();
    const entries = adapter.entries();
    const sizes = new Map<string, number>();
    for (const [id, e] of entries) sizes.set(id, e.bytes);
    const expectedBytes = new Map<string, number>();
    for (const t of p.queue) {
      const e = expectedBytesFor(t);
      if (e !== undefined) expectedBytes.set(t.id, e);
    }
    const stats = adapter.stats();
    return {
      queue: p.queue,
      index: p.index,
      loopMode: p.loopMode,
      context: p.context,
      baseCount: p.baseCount,
      playedSec: effectivePlayedSec(pb.playedSec, deps.overrides),
      bufferedToEnd: pb.bufferedToEnd,
      playing: p.playing,
      online: c.online,
      metered: c.metered,
      saveData: c.saveData,
      batterySaver: c.batterySaver,
      enabled: s.enabled,
      allowMetered: s.allowMetered,
      requestCurrent: !adapter.writesThrough,
      cached: new Set(entries.keys()),
      inFlight: inFlight?.id ?? null,
      bytes: stats.bytes,
      cap: stats.cap,
      sizes,
      expectedBytes,
      backoffUntil,
      attempts,
      nowMs: now(),
    };
  }

  function lastUsedMap(): Map<string, number> {
    const m = new Map<string, number>();
    for (const [id, e] of adapter.entries()) m.set(id, e.lastUsedAt);
    return m;
  }

  function setInFlight(next: typeof inFlight) {
    inFlight = next;
    deps.onInFlight?.(next?.id ?? null);
  }

  function cancel() {
    if (!inFlight) return;
    log('abort', { id: inFlight.id });
    inFlight.controller.abort();
    setInFlight(null);
  }

  function clearWake() {
    if (wakeTimer) clearTimeout(wakeTimer);
    wakeTimer = null;
  }

  async function run(id: string, track: Track, controller: AbortController, evict: string[]) {
    let result: FetchResult;
    try {
      if (evict.length > 0) {
        log('evict', { ids: evict });
        await adapter.evict(evict);
        deps.onCacheChange?.();
      }
      if (controller.signal.aborted) return;
      result = await adapter.prefetch(track, controller.signal);
    } catch {
      result = { kind: 'failed' };
    }
    // An aborted run was already cleared by cancel(): its answer means nothing.
    if (disposed || controller.signal.aborted || inFlight?.controller !== controller) return;
    setInFlight(null);
    const ledger = onResult(buildInput(), id, result);
    backoffUntil = ledger.backoffUntil;
    attempts = ledger.attempts;
    log('result', { id, result: result.kind, drop: ledger.drop });
    if (result.kind === 'done') {
      // The real size can beat the estimate (a long upload): trim back under the cap.
      const trim = evictToFit(buildInput(), lastUsedMap(), 0);
      if (trim.evict.length > 0) await adapter.evict(trim.evict);
      deps.onCacheChange?.();
    }
    tick();
  }

  function tick() {
    if (disposed) return;
    clearWake();
    const input = buildInput();
    const action = nextAction(input);
    last = action;
    if (action.kind === 'abort') {
      cancel();
      tick();
      return;
    }
    if (action.kind === 'idle') {
      // The device-level gates do not abort by themselves (policy README):
      // the driver does, so a download never runs against a setting that
      // was just turned off, on mobile data, or into a dead connection.
      if (inFlight && ['disabled', 'offline', 'battery', 'metered'].includes(action.reason)) cancel();
      if (action.reason === 'backoff' && action.wakeAtMs !== undefined) {
        wakeTimer = setTimeout(tick, Math.max(0, action.wakeAtMs - input.nowMs));
      }
      return;
    }
    const track = input.queue.find((t) => t.id === action.id) as Track | undefined;
    if (!track) return;
    const plan = evictToFit(input, lastUsedMap(), input.expectedBytes?.get(track.id) ?? POLICY.EXPECTED_BYTES_DEFAULT);
    if (!plan.fits) return;
    const controller = new AbortController();
    setInFlight({ id: action.id, controller });
    log('start', { id: action.id });
    void run(action.id, track, controller, plan.evict);
  }

  return {
    tick,
    trackStarted(id) {
      if (adapter.has(id)) adapter.touch(id);
      tick();
    },
    cancel,
    lastAction: () => last,
    dispose() {
      disposed = true;
      clearWake();
      cancel();
    },
  };
}
