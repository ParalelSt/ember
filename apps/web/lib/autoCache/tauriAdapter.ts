'use client';

/** Desktop (Tauri) storage for the auto cache of upcoming songs.
 *
 *  The web layer decides what to cache (policy.ts through useAutoCache); this
 *  adapter only moves bytes, through the shell's `cache_*` commands
 *  (apps/desktop/src-tauri/src/cache.rs): a directory under the OS cache dir,
 *  capped at 500 MB and 100 songs, least recently played evicted first.
 *
 *  Playback: `localSrcFor(id)` returns `cache:<id>`, which tauriBackend.load
 *  hands to the engine as the song's cache key, and the engine opens its file
 *  (streaming from where it came from if the file will not decode). Passing
 *  `LoadOptions.cacheKey = track.id` beside the stream URL does the same.
 *
 *  An older desktop build has no `cache_*` commands: the ACL refuses them (or
 *  the bridge never answers), `ready()` resolves false, `kind` becomes
 *  'none' and every method is a harmless no-op. */

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { apiUrl } from '@/lib/api';
import { detectShell } from '@/lib/playback/detectShell';
import { sessionCookie, TAURI_CACHE_PREFIX, toAbsolute } from '@/lib/playback/tauriBackend';
import type { Track } from '@/types/track';

export type PrefetchResult =
  | { kind: 'done'; bytes: number }
  | { kind: 'retry-after'; status: 429 | 503; seconds: number | null }
  | { kind: 'gone' }
  | { kind: 'failed' };

/** The plan's `CacheAdapter` (Task 5 defines it in ./adapter.ts). Declared
 *  here with the same shape so this file stands alone until the branches
 *  meet; on merge, replace it with `import type { CacheAdapter } from './adapter'`. */
export interface CacheAdapter {
  kind: 'opfs' | 'tauri' | 'android-native' | 'none';
  ready(): Promise<boolean>;
  has(id: string): boolean;
  localSrcFor(id: string): string | null;
  prefetch(track: Track, signal: AbortSignal): Promise<PrefetchResult>;
  touch(id: string): void;
  evict(ids: string[]): Promise<void>;
  stats(): { bytes: number; count: number; cap: number };
  clear(): Promise<void>;
  writesThrough: boolean;
}

/** Matches CAP_BYTES in cache.rs; replaced by the shell's own figure once
 *  `cache_stats` answers. */
export const TAURI_CACHE_CAP_BYTES = 500 * 1024 * 1024;

/** The bridge can be absent or refused on the remote origin, and then
 *  invoke() may never settle (see lib/desktopLog.ts). */
const READY_TIMEOUT_MS = 2000;

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export interface TauriCacheDeps {
  invoke?: Invoke;
  isTauri?: () => boolean;
  readyTimeoutMs?: number;
}

/** What `cache_prefetch` answers (serde-tagged `PrefetchOutcome`). */
type RawOutcome =
  | { kind: 'done'; bytes: number }
  | { kind: 'retry-after'; status: number; seconds: number | null }
  | { kind: 'gone' }
  | { kind: 'failed'; message?: string }
  | { kind: 'busy' }
  | { kind: 'cancelled' };

interface RawStats { bytes: number; count: number; cap: number; maxFiles?: number }

/** The engine's answer as the policy's result. `busy` (another prefetch
 *  running, which the policy's one-at-a-time rule makes rare) and
 *  `cancelled` (the driver aborted it and ignores the answer) count as
 *  failed; so does anything this build does not recognise. */
export function mapPrefetchOutcome(raw: unknown): PrefetchResult {
  const o = raw as Partial<RawOutcome> | null;
  switch (o?.kind) {
    case 'done': {
      const bytes = (o as { bytes?: unknown }).bytes;
      return typeof bytes === 'number' && bytes >= 0 ? { kind: 'done', bytes } : { kind: 'failed' };
    }
    case 'retry-after': {
      const { status, seconds } = o as { status?: unknown; seconds?: unknown };
      if (status !== 429 && status !== 503) return { kind: 'failed' };
      return {
        kind: 'retry-after',
        status,
        seconds: typeof seconds === 'number' && Number.isFinite(seconds) ? seconds : null,
      };
    }
    case 'gone':
      return { kind: 'gone' };
    default:
      return { kind: 'failed' };
  }
}

/** The absolute stream URL with the server's low-priority `prefetch=1`
 *  marker (see the stream route): the engine is outside the webview, so a
 *  relative URL means nothing to it. */
export function prefetchUrlFor(streamUrl: string): string {
  const base = /^https?:\/\//i.test(streamUrl) ? streamUrl : apiUrl(streamUrl);
  const abs = toAbsolute(base);
  return abs + (abs.includes('?') ? '&' : '?') + 'prefetch=1';
}

export function createTauriCacheAdapter(deps: TauriCacheDeps = {}): CacheAdapter & { refresh(): Promise<void> } {
  const call: Invoke = deps.invoke ?? (tauriInvoke as Invoke);
  const isTauri = deps.isTauri ?? (() => detectShell() === 'tauri');
  const readyTimeoutMs = deps.readyTimeoutMs ?? READY_TIMEOUT_MS;

  let state: 'unknown' | 'ok' | 'unavailable' = 'unknown';
  let readyPromise: Promise<boolean> | null = null;
  let keys = new Set<string>();
  let snapshot = { bytes: 0, count: 0, cap: TAURI_CACHE_CAP_BYTES };

  const withTimeout = <T,>(p: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('the desktop shell did not answer')), readyTimeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
  };

  /** Re-reads the shell's keys and totals: the source of truth, since the
   *  engine touches, and a prefetch may evict, without the page asking. */
  const refresh = async (): Promise<void> => {
    const [ids, stats] = await Promise.all([call<string[]>('cache_keys'), call<RawStats>('cache_stats')]);
    keys = new Set(Array.isArray(ids) ? ids.filter((k) => typeof k === 'string') : []);
    snapshot = {
      bytes: typeof stats?.bytes === 'number' ? stats.bytes : 0,
      count: typeof stats?.count === 'number' ? stats.count : keys.size,
      cap: typeof stats?.cap === 'number' ? stats.cap : TAURI_CACHE_CAP_BYTES,
    };
  };
  const refreshQuietly = () => refresh().catch(() => {});

  const available = () => state === 'ok';

  const adapter: CacheAdapter & { refresh(): Promise<void> } = {
    get kind() {
      return state === 'unavailable' ? 'none' : 'tauri';
    },
    writesThrough: true,

    ready() {
      if (!readyPromise) {
        readyPromise = (async () => {
          if (!isTauri()) {
            state = 'unavailable';
            return false;
          }
          try {
            await withTimeout(refresh());
            state = 'ok';
            return true;
          } catch {
            // "Command cache_keys not allowed by ACL": a desktop build from
            // before the auto cache. Settings says to update the app.
            state = 'unavailable';
            return false;
          }
        })();
      }
      return readyPromise;
    },

    has: (id) => available() && keys.has(id),

    localSrcFor: (id) => (available() && keys.has(id) ? TAURI_CACHE_PREFIX + id : null),

    async prefetch(track, signal) {
      if (!available() || signal.aborted || !track.streamUrl) return { kind: 'failed' };
      const onAbort = () => {
        void call('cache_cancel').catch(() => {});
      };
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        const raw = await call<unknown>('cache_prefetch', {
          url: prefetchUrlFor(track.streamUrl),
          key: track.id,
          cookie: sessionCookie(),
        });
        const result = mapPrefetchOutcome(raw);
        if (result.kind === 'done') {
          keys.add(track.id);
          // The shell may have evicted older songs to make room.
          await refreshQuietly();
        }
        return result;
      } catch {
        return { kind: 'failed' };
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    },

    touch(id) {
      if (!available() || !keys.has(id)) return;
      void call('cache_touch', { key: id }).catch(() => {});
    },

    async evict(ids) {
      if (!available() || ids.length === 0) return;
      try {
        await call('cache_evict', { keys: ids });
      } catch {
        // Left as it was; the refresh below reports what is really there.
      }
      for (const id of ids) keys.delete(id);
      await refreshQuietly();
    },

    stats: () => ({ ...snapshot }),

    async clear() {
      if (!available()) return;
      try {
        await call('cache_clear');
      } catch {
        // Same as evict: the refresh tells the truth.
      }
      keys = new Set();
      snapshot = { ...snapshot, bytes: 0, count: 0 };
      await refreshQuietly();
    },

    refresh,
  };
  return adapter;
}

/** The desktop app's adapter. Creating it does nothing; `ready()` asks the
 *  shell for the first time. */
export const tauriCacheAdapter = createTauriCacheAdapter();
