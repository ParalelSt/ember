const NAMESPACE = 'ember.lyrics.offset.v1';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface StoredEntry {
  offset: number;
  computedAt: number;
  lrcHash: string;
}

/** Minimal Storage-like surface. Lets tests inject an in-memory mock. */
interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

let storage: StorageLike | null = null;

function getStorage(): StorageLike | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  storage = window.localStorage;
  return storage;
}

/** Test-only: replace the storage backend with a mock. */
export function _setStorageForTests(s: StorageLike): void {
  storage = s;
}

function keyFor(trackId: string): string {
  return `${NAMESPACE}.${trackId}`;
}

/** Read the cached offset for this (track, lrc) pair. Returns null when:
 *  - no entry exists,
 *  - entry was written with a different LRC hash (matched LRC changed),
 *  - entry is older than 30 days,
 *  - storage is unavailable (SSR), or JSON is malformed. */
export function readOffset(trackId: string, lrcHash: string): number | null {
  const s = getStorage();
  if (!s) return null;
  const raw = s.getItem(keyFor(trackId));
  if (!raw) return null;
  let parsed: StoredEntry;
  try {
    parsed = JSON.parse(raw) as StoredEntry;
  } catch {
    return null;
  }
  if (parsed.lrcHash !== lrcHash) return null;
  if (Date.now() - parsed.computedAt > TTL_MS) return null;
  if (typeof parsed.offset !== 'number') return null;
  return parsed.offset;
}

/** Persist an offset for this (track, lrc) pair. No-op when storage
 *  is unavailable. Failures (quota exceeded, etc.) are swallowed. */
export function writeOffset(trackId: string, lrcHash: string, offset: number): void {
  const s = getStorage();
  if (!s) return;
  const entry: StoredEntry = { offset, computedAt: Date.now(), lrcHash };
  try {
    s.setItem(keyFor(trackId), JSON.stringify(entry));
  } catch {
    // ignore quota / disabled-storage errors
  }
}
