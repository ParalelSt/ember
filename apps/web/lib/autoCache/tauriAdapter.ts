'use client';

/** Desktop (Tauri) storage for the auto cache of upcoming songs.
 *
 *  The web layer decides what to cache (policy.ts through useAutoCache); this
 *  adapter only moves bytes, through the shell's `cache_*` commands
 *  (apps/desktop/src-tauri/src/cache.rs): a directory under the OS cache dir,
 *  capped at 500 MB and 100 songs, least recently played evicted first.
 *
 *  Playback: `localSrcFor` is always null. PlayerProvider passes
 *  `LoadOptions.cacheKey = track.id` beside the stream URL whenever `has(id)`,
 *  and the engine opens its cached file by that key (streaming the URL if the
 *  file will not decode).
 *
 *  An older desktop build has no `cache_*` commands: the ACL refuses them (or
 *  the bridge never answers), `ready()` resolves false, `kind` becomes
 *  'none' and every method is a harmless no-op. */

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { apiUrl } from '@/lib/api';
import { detectShell } from '@/lib/playback/detectShell';
import { sessionCookie, toAbsolute } from '@/lib/playback/tauriBackend';
import { withPrefetchParam, type CacheAdapter, type CacheEntry, type CacheStats } from './adapter';
import type { FetchResult } from './policy';

/** Kept as a name for the tests and callers that speak of prefetch results. */
export type PrefetchResult = FetchResult;

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
export function mapPrefetchOutcome(raw: unknown): FetchResult {
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
  return withPrefetchParam(toAbsolute(base));
}

interface RawEntry { key?: unknown; bytes?: unknown; lastUsedMs?: unknown }

function toEntries(raw: unknown): Map<string, CacheEntry> {
  const m = new Map<string, CacheEntry>();
  if (!Array.isArray(raw)) return m;
  for (const r of raw as RawEntry[]) {
    if (typeof r?.key !== 'string') continue;
    const bytes = typeof r.bytes === 'number' && r.bytes >= 0 ? r.bytes : 0;
    const lastUsedAt = typeof r.lastUsedMs === 'number' ? r.lastUsedMs : 0;
    m.set(r.key, { bytes, lastUsedAt });
  }
  return m;
}

export type TauriCacheAdapter = CacheAdapter & {
  /** Re-reads the shell's entries and totals. */
  reload(): Promise<void>;
};

export function createTauriCacheAdapter(deps: TauriCacheDeps = {}): TauriCacheAdapter {
  const call: Invoke = deps.invoke ?? (tauriInvoke as Invoke);
  const isTauri = deps.isTauri ?? (() => detectShell() === 'tauri');
  const readyTimeoutMs = deps.readyTimeoutMs ?? READY_TIMEOUT_MS;

  let state: 'unknown' | 'ok' | 'unavailable' = 'unknown';
  let readyPromise: Promise<boolean> | null = null;
  let entries = new Map<string, CacheEntry>();
  let snapshot: CacheStats = { bytes: 0, count: 0, cap: TAURI_CACHE_CAP_BYTES };
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of listeners) {
      try { l(); } catch { /* one bad listener must not stop the rest */ }
    }
  };

  const withTimeout = <T,>(p: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('the desktop shell did not answer')), readyTimeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
  };

  /** Re-reads the shell's entries and totals: the source of truth, since the
   *  engine touches, and a prefetch may evict, without the page asking. */
  const refresh = async (): Promise<void> => {
    const [raw, stats] = await Promise.all([call<unknown>('cache_entries'), call<RawStats>('cache_stats')]);
    entries = toEntries(raw);
    snapshot = {
      bytes: typeof stats?.bytes === 'number' ? stats.bytes : 0,
      count: typeof stats?.count === 'number' ? stats.count : entries.size,
      cap: typeof stats?.cap === 'number' ? stats.cap : TAURI_CACHE_CAP_BYTES,
    };
    notify();
  };
  const refreshQuietly = () => refresh().catch(() => {});

  const available = () => state === 'ok';

  const adapter: TauriCacheAdapter = {
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
            // "Command cache_entries not allowed by ACL": a desktop build from
            // before the auto cache. Settings says to update the app.
            state = 'unavailable';
            return false;
          }
        })();
      }
      return readyPromise;
    },

    has: (id) => available() && entries.has(id),

    // The engine opens the file by LoadOptions.cacheKey, not by a URL.
    localSrcFor: () => null,

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
          entries.set(track.id, { bytes: result.bytes, lastUsedAt: Date.now() });
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
      if (!available()) return;
      const e = entries.get(id);
      if (!e) return;
      entries.set(id, { ...e, lastUsedAt: Date.now() });
      void call('cache_touch', { key: id }).catch(() => {});
    },

    async evict(ids) {
      if (!available() || ids.length === 0) return;
      try {
        await call('cache_evict', { keys: ids });
      } catch {
        // Left as it was; the refresh below reports what is really there.
      }
      for (const id of ids) entries.delete(id);
      await refreshQuietly();
    },

    entries: () => entries,

    stats: () => ({ ...snapshot }),

    async clear() {
      if (!available()) return;
      try {
        await call('cache_clear');
      } catch {
        // Same as evict: the refresh tells the truth.
      }
      entries = new Map();
      snapshot = { ...snapshot, bytes: 0, count: 0 };
      await refreshQuietly();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async reload() {
      if (available()) await refreshQuietly();
    },
  };
  return adapter;
}

/** The desktop app's adapter. Creating it does nothing; `ready()` asks the
 *  shell for the first time. */
export const tauriCacheAdapter = createTauriCacheAdapter();
