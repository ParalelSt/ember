import type { Track } from '../../types/track';
import type { FetchResult } from './policy';

/** Where a platform keeps its auto-cached songs. `useAutoCache` drives the
 *  policy (policy.ts) through this and nothing else, so one hook serves the
 *  browser (OPFS), the desktop app (a Tauri cache dir) and Android (a mirror
 *  of the native player's own cache). The contract is spelled out in
 *  README.md next to this file. */

export type CacheAdapterKind = 'opfs' | 'tauri' | 'android-native' | 'none';

/** One cached song as the adapter's in-memory index knows it. */
export interface CacheEntry {
  bytes: number;
  /** ms since epoch, bumped by `touch`. Eviction is least recently used. */
  lastUsedAt: number;
}

export interface CacheStats {
  bytes: number;
  count: number;
  cap: number;
}

export interface CacheAdapter {
  readonly kind: CacheAdapterKind;
  /** True: the player itself writes the current track through to its cache
   *  (Android SimpleCache, the desktop stream temp file), so the driver never
   *  requests it (policy `requestCurrent = !writesThrough`). */
  readonly writesThrough: boolean;
  /** Loads the index. Resolves false when this device cannot cache (no OPFS,
   *  an app shell too old for the cache commands); the driver then stays off
   *  and Settings says why. Never rejects. */
  ready(): Promise<boolean>;
  /** Sync, from the in-memory index: is this id fully on disk? */
  has(id: string): boolean;
  /** Sync: a source the CURRENT backend can load for a cached id, or null.
   *  OPFS: a blob: URL. Desktop: null (the provider passes
   *  `LoadOptions.cacheKey` instead and Rust opens the file). Android: null
   *  (the native player resolves its own cache). */
  localSrcFor(id: string): string | null;
  /** Downloads one song with `?prefetch=1`. Resolves with the server's
   *  answer mapped for `policy.onResult`; never rejects. When `signal`
   *  aborts it cleans up and resolves (any value: the driver ignores the
   *  result of an aborted run). Adapters that never download from JS
   *  (Android) resolve `{ kind: 'failed' }`. */
  prefetch(track: Track, signal: AbortSignal): Promise<FetchResult>;
  /** lastUsedAt = now for a cached id; a no-op for anything else. */
  touch(id: string): void;
  /** Deletes these ids (unknown ids are ignored). */
  evict(ids: string[]): Promise<void>;
  /** Sync snapshot of every cached id. The driver feeds sizes and last-used
   *  times from here into the policy's size check and eviction order. */
  entries(): ReadonlyMap<string, CacheEntry>;
  stats(): CacheStats;
  /** Deletes everything this adapter cached (never pinned downloads). */
  clear(): Promise<void>;
  /** For adapters whose contents change outside the driver (the native
   *  Android cache, a desktop clear from another window): call `listener`
   *  after each change. Returns the unsubscribe. Optional. */
  subscribe?(listener: () => void): () => void;
  /** For adapters whose totals live outside the page (desktop, Android):
   *  re-read them, then call the `subscribe` listeners. Settings calls it on
   *  open so the storage line is current. Optional. */
  reload?(): Promise<void>;
}

const EMPTY = new Map<string, CacheEntry>();

/** The adapter for a device that cannot cache: nothing is ever cached, and
 *  Settings shows the "not available" line. */
export const noneAdapter: CacheAdapter = {
  kind: 'none',
  writesThrough: false,
  ready: async () => false,
  has: () => false,
  localSrcFor: () => null,
  prefetch: async () => ({ kind: 'failed' }),
  touch: () => {},
  evict: async () => {},
  entries: () => EMPTY,
  stats: () => ({ bytes: 0, count: 0, cap: 0 }),
  clear: async () => {},
};

/** `url` with `prefetch=1` added, keeping any query it already has. */
export function withPrefetchParam(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}prefetch=1`;
}

/** Seconds from a Retry-After header (delta-seconds or an HTTP date), or
 *  null when absent or unreadable. */
export function parseRetryAfter(value: string | null, nowMs: number = Date.now()): number | null {
  if (value == null || value.trim() === '') return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v);
  const at = Date.parse(v);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - nowMs) / 1000));
}

/** Maps a stream response status to the policy's result, or null for a
 *  success the adapter should go on to store. */
export function resultForStatus(status: number, retryAfter: string | null, nowMs?: number): FetchResult | null {
  if (status === 429 || status === 503) {
    return { kind: 'retry-after', status, seconds: parseRetryAfter(retryAfter, nowMs) };
  }
  if (status === 410) return { kind: 'gone' };
  if (status < 200 || status >= 300) return { kind: 'failed' };
  return null;
}
