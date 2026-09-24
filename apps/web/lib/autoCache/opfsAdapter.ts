import { apiUrl } from '../api';
import {
  atomicWriteJson,
  deleteEntry,
  ensureDir,
  getOpfsRoot,
  listEntries,
  readBlob,
  readJson,
  writeStreamToOpfs,
} from '../opfs';
import type { Track } from '../../types/track';
import type { FetchResult } from './policy';
import { resultForStatus, withPrefetchParam, type CacheAdapter, type CacheEntry } from './adapter';

/** The browser's auto cache, in the Origin Private File System:
 *
 *    cache/index.json        { v: 1, entries: { [id]: { bytes, mime, lastUsedAt, addedAt } } }
 *    cache/audio/<name>.bin  one song per file, <name> = encodeURIComponent(id)
 *
 *  Separate from pinned downloads (playlists/ in lib/offline.ts), which it
 *  never touches, and untouched by RegisterSW (that only clears Cache
 *  Storage and service workers).
 *
 *  A download streams into `<name>.part` and only becomes `<name>.bin` once
 *  the whole body arrived, so a half-written file is never handed to the
 *  player. The rename is FileSystemFileHandle.move (Chrome, Edge, Firefox,
 *  Safari 17+, the same call atomicWriteJson already relies on); where it is
 *  missing, the finished .part is copied to the final name and deleted. Stray
 *  .part files (a tab closed mid-download) are deleted at boot.
 *
 *  Each cached file gets a blob: URL at boot and after its download: the
 *  File behind it is a handle on disk, not the bytes in memory, so this is
 *  cheap, and it keeps `localSrcFor` synchronous (loadAndPlay must stay
 *  inside the user's gesture). */

export const CACHE_CAP_BYTES = 250 * 1024 * 1024;
const INDEX_FILE = 'index.json';

interface IndexEntry {
  bytes: number;
  mime: string;
  lastUsedAt: number;
  addedAt: number;
}

interface CacheIndex {
  v: 1;
  entries: Record<string, IndexEntry>;
}

type MovableFileHandle = FileSystemFileHandle & { move?: (name: string) => Promise<void> };

export interface OpfsAdapterDeps {
  getRoot?: () => Promise<FileSystemDirectoryHandle>;
  fetch?: typeof fetch;
  now?: () => number;
  /** navigator.storage.estimate, or a fake. */
  estimate?: () => Promise<{ quota?: number }>;
  /** Stream URL -> absolute URL (lib/api apiUrl). */
  resolveUrl?: (streamUrl: string) => string;
}

export function fileNameFor(id: string): string {
  return `${encodeURIComponent(id)}.bin`;
}

function idFromFileName(name: string): string | null {
  if (!name.endsWith('.bin')) return null;
  try {
    return decodeURIComponent(name.slice(0, -4));
  } catch {
    return null;
  }
}

export function opfsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
}

export function createOpfsAdapter(deps: OpfsAdapterDeps = {}): CacheAdapter {
  const getRoot = deps.getRoot ?? getOpfsRoot;
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const now = deps.now ?? Date.now;
  const resolveUrl = deps.resolveUrl ?? apiUrl;
  const estimate = deps.estimate ?? (() => navigator.storage?.estimate?.() ?? Promise.resolve({}));

  let cacheDir: FileSystemDirectoryHandle | null = null;
  let audioDir: FileSystemDirectoryHandle | null = null;
  let index: CacheIndex = { v: 1, entries: {} };
  let cap = CACHE_CAP_BYTES;
  const urls = new Map<string, string>();
  let readyPromise: Promise<boolean> | null = null;
  // Index writes are chained so two quick changes cannot interleave.
  let writing: Promise<void> = Promise.resolve();

  const persist = () => {
    const dir = cacheDir;
    if (!dir) return writing;
    const snapshot: CacheIndex = { v: 1, entries: { ...index.entries } };
    writing = writing.then(() => atomicWriteJson(dir, INDEX_FILE, snapshot)).catch(() => {});
    return writing;
  };

  const setUrl = (id: string, file: File) => {
    const old = urls.get(id);
    if (old) URL.revokeObjectURL(old);
    urls.set(id, URL.createObjectURL(file));
  };

  const dropUrl = (id: string) => {
    const old = urls.get(id);
    if (old) URL.revokeObjectURL(old);
    urls.delete(id);
  };

  async function load(): Promise<boolean> {
    if (!deps.getRoot && !opfsSupported()) return false;
    try {
      const root = await getRoot();
      cacheDir = await ensureDir(root, ['cache']);
      audioDir = await ensureDir(cacheDir, ['audio']);
      const stored = await readJson<CacheIndex>(cacheDir, INDEX_FILE);
      const entries: Record<string, IndexEntry> = stored?.v === 1 && stored.entries ? stored.entries : {};
      const next: Record<string, IndexEntry> = {};
      let changed = !stored;
      // Reconcile with what is really on disk: stray .part files and files
      // the index forgot are deleted; entries whose file is gone are dropped.
      for (const { name, kind } of await listEntries(audioDir)) {
        if (kind !== 'file') continue;
        const id = idFromFileName(name);
        const entry = id ? entries[id] : undefined;
        if (!id || !entry) {
          await deleteEntry(audioDir, name);
          changed = true;
          continue;
        }
        const file = await readBlob(audioDir, name);
        if (!file || file.size === 0) {
          await deleteEntry(audioDir, name);
          changed = true;
          continue;
        }
        if (file.size !== entry.bytes) changed = true;
        next[id] = { ...entry, bytes: file.size };
        setUrl(id, file);
      }
      if (Object.keys(next).length !== Object.keys(entries).length) changed = true;
      index = { v: 1, entries: next };
      try {
        const { quota } = await estimate();
        if (typeof quota === 'number' && quota > 0) cap = Math.min(CACHE_CAP_BYTES, Math.floor(quota * 0.5));
      } catch {
        // No estimate: keep the fixed cap.
      }
      if (changed) await persist();
      return true;
    } catch {
      cacheDir = null;
      audioDir = null;
      return false;
    }
  }

  /** Moves the finished .part into place. */
  async function finalize(dir: FileSystemDirectoryHandle, partName: string, finalName: string): Promise<void> {
    const handle = (await dir.getFileHandle(partName)) as MovableFileHandle;
    await deleteEntry(dir, finalName);
    if (typeof handle.move === 'function') {
      await handle.move(finalName);
      return;
    }
    const file = await handle.getFile();
    await writeStreamToOpfs(dir, finalName, file.stream());
    await deleteEntry(dir, partName);
  }

  const adapter: CacheAdapter = {
    kind: 'opfs',
    writesThrough: false,

    ready() {
      readyPromise ??= load();
      return readyPromise;
    },

    has: (id) => id in index.entries,

    localSrcFor: (id) => (id in index.entries ? urls.get(id) ?? null : null),

    async prefetch(track: Track, signal: AbortSignal): Promise<FetchResult> {
      const dir = audioDir;
      if (!dir) return { kind: 'failed' };
      const finalName = fileNameFor(track.id);
      const partName = `${finalName}.part`;
      try {
        const res = await doFetch(withPrefetchParam(resolveUrl(track.streamUrl)), { signal, credentials: 'include' });
        const mapped = resultForStatus(res.status, res.headers.get('retry-after'), now());
        if (mapped) {
          await res.body?.cancel().catch(() => {});
          return mapped;
        }
        const mime = res.headers.get('content-type') ?? '';
        // A signed-out session is answered with the sign-in page: storing
        // that as audio would only fail at play time.
        if (!res.body || mime.startsWith('text/html')) return { kind: 'failed' };
        const bytes = await writeStreamToOpfs(dir, partName, res.body, signal);
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (bytes === 0) {
          await deleteEntry(dir, partName);
          return { kind: 'failed' };
        }
        await finalize(dir, partName, finalName);
        const file = await readBlob(dir, finalName);
        if (!file) return { kind: 'failed' };
        const t = now();
        index.entries[track.id] = { bytes: file.size, mime, lastUsedAt: t, addedAt: t };
        setUrl(track.id, file);
        await persist();
        return { kind: 'done', bytes: file.size };
      } catch {
        await deleteEntry(dir, partName).catch(() => {});
        return { kind: 'failed' };
      }
    },

    touch(id) {
      const entry = index.entries[id];
      if (!entry) return;
      entry.lastUsedAt = now();
      void persist();
    },

    async evict(ids) {
      const dir = audioDir;
      let changed = false;
      for (const id of ids) {
        if (!(id in index.entries)) continue;
        delete index.entries[id];
        dropUrl(id);
        changed = true;
        if (dir) await deleteEntry(dir, fileNameFor(id)).catch(() => {});
      }
      if (changed) await persist();
    },

    entries() {
      const out = new Map<string, CacheEntry>();
      for (const [id, e] of Object.entries(index.entries)) out.set(id, { bytes: e.bytes, lastUsedAt: e.lastUsedAt });
      return out;
    },

    stats() {
      let bytes = 0;
      const all = Object.values(index.entries);
      for (const e of all) bytes += e.bytes;
      return { bytes, count: all.length, cap };
    },

    async clear() {
      for (const id of [...urls.keys()]) dropUrl(id);
      index = { v: 1, entries: {} };
      const dir = cacheDir;
      if (!dir) return;
      await deleteEntry(dir, 'audio', { recursive: true }).catch(() => {});
      audioDir = await ensureDir(dir, ['audio']).catch(() => null);
      await persist();
    },
  };
  return adapter;
}
