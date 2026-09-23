'use client';

import type { Playlist, Track } from '@/types/track';
import { useOfflineStore } from '@/stores/useOfflineStore';
import {
  atomicWriteJson,
  deleteEntry,
  ensureDir,
  getDirIfExists,
  getOpfsRoot,
  listEntries,
  readBlob,
  readJson,
  requestPersistence,
  writeStreamToOpfs,
} from '@/lib/opfs';
import { apiUrl } from '@/lib/api';
import {
  nativeCancel,
  nativeClearAll,
  nativeOfflinePresent,
  nativePin,
  nativeStatus,
  nativeUnpin,
  subscribeNative,
  type NativeStatus,
} from '@/lib/offlineNative';

import { isUnavailable } from '@/lib/playback/queueNav';

/** Pin id for the Liked songs pseudo-playlist. A playlist's own pin id is
 *  its PocketBase id as-is. */
export const LIKED_PIN = 'liked';

/** Pin id for the Recently played pseudo-playlist. Matches
 *  `pinIdFor({ kind: 'recent' })` in lib/collections.ts. */
export const RECENT_PIN = 'recent';

/** The tracks worth pinning: never pin one we already know the server
 *  can't stream, since that only burns a failed fetch and leaves a hole in
 *  the offline copy. */
export function playableFor(tracks: Track[]): Track[] {
  return tracks.filter((t) => !isUnavailable(t));
}

/** Pins any system list (Liked, Recently played, Uploads) under a fixed id.
 *  Native only: the browser-storage path only knows playlists, and every
 *  button that calls this is gated on the plugin's presence. */
export async function pinList(id: string, name: string, tracks: Track[]): Promise<void> {
  if (!nativeOfflinePresent()) throw new Error('Offline downloads need the Android app');
  useOfflineStore.getState().setNativeStatus(await nativePin(id, name, playableFor(tracks)));
}

export const OFFLINE_SCHEMA_VERSION = 1 as const;

export interface OfflineTrackEntry {
  id: string;
  sourceId: string;
  title: string;
  artist: string;
  artistId: string | null;
  album: string | null;
  durationSec: number;
  audioFile: string;
  artFile: string | null;
  bytesAudio: number;
  bytesArt: number;
}

export interface OfflineManifest {
  schemaVersion: 1;
  playlistId: string;
  name: string;
  artworkFile: string | null;
  downloadedAt: string;
  tracks: OfflineTrackEntry[];
}

export interface OfflineMeta {
  schemaVersion: 1;
  downloadedPlaylistIds: string[];
  totalBytes: number;
}

const META_FILE = 'meta.json';
const PLAYLISTS_DIR = 'playlists';

const aborters = new Map<string, AbortController>();

/** hydrateOfflineStore runs once per boot in theory, twice under React
 *  StrictMode in practice, and the native `offline` subscription has no
 *  unsubscribe on this path: without this flag every plugin event would be
 *  applied once per registration. */
let nativeSubscribed = false;

function extFromContentType(ct: string | null, fallback: string): string {
  if (!ct) return fallback;
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('png')) return '.png';
  if (ct.includes('jpeg') || ct.includes('jpg')) return '.jpg';
  return fallback;
}

async function readMeta(): Promise<OfflineMeta> {
  const root = await getOpfsRoot();
  const existing = await readJson<OfflineMeta>(root, META_FILE);
  return existing ?? { schemaVersion: 1, downloadedPlaylistIds: [], totalBytes: 0 };
}

async function writeMeta(meta: OfflineMeta): Promise<void> {
  const root = await getOpfsRoot();
  await atomicWriteJson(root, META_FILE, meta);
}

/** Gives every audio file a browser-storage download holds a blob: URL the
 *  player can load (PlayerProvider reads `webFiles`). The File behind it is a
 *  handle on disk, not the bytes in memory. `fresh` names tracks just written
 *  again, whose old URL points at the replaced file; any other track keeps
 *  its URL, since revoking one can cut off the song that is playing. */
async function indexWebFiles(fresh: Set<string> = new Set()): Promise<void> {
  const old = useOfflineStore.getState().webFiles;
  const next: Record<string, string> = {};
  const root = await getOpfsRoot();
  const playlistsDir = await getDirIfExists(root, [PLAYLISTS_DIR]);
  for (const { name, kind } of playlistsDir ? await listEntries(playlistsDir) : []) {
    if (kind !== 'directory') continue;
    const dir = await getDirIfExists(root, [PLAYLISTS_DIR, name]);
    if (!dir) continue;
    const manifest = await readJson<OfflineManifest>(dir, 'manifest.json');
    for (const t of manifest?.tracks ?? []) {
      if (next[t.id]) continue;
      if (old[t.id] && !fresh.has(t.id)) { next[t.id] = old[t.id]; continue; }
      const parts = t.audioFile.split('/');
      const fileName = parts.pop()!;
      const audioDir = await getDirIfExists(dir, parts);
      const file = audioDir && await readBlob(audioDir, fileName);
      if (file) next[t.id] = URL.createObjectURL(file);
    }
  }
  for (const [id, url] of Object.entries(old)) if (!next[id]) URL.revokeObjectURL(url);
  useOfflineStore.getState().setWebFiles(next);
}

interface SwIndexAdd {
  type: 'index-add';
  entries: Array<{ videoId: string; playlistId: string; audioFilePath: string }>;
}

interface SwIndexRemove {
  type: 'index-remove';
  videoIds: string[] | '*';
}

async function notifySwIndex(message: SwIndexAdd | SwIndexRemove): Promise<void> {
  if (typeof navigator === 'undefined') return;
  // Ember no longer runs a service worker (see RegisterSW / public/sw.js). With
  // no SW controlling the page, `serviceWorker.ready` never resolves — bail out
  // instead of awaiting a promise that hangs forever. (Offline SW messaging is
  // dormant and moving to the native app.)
  if (!navigator.serviceWorker?.controller) return;
  const reg = await navigator.serviceWorker.ready;
  reg?.active?.postMessage(message);
}

/** Hydrates the offline store at app boot. On Android this subscribes to the
 *  native plugin's `offline` events and pulls its current status; everywhere
 *  else it reads OPFS. Idempotent. */
export async function hydrateOfflineStore(): Promise<void> {
  if (nativeOfflinePresent()) {
    const apply = (s: NativeStatus) => useOfflineStore.getState().setNativeStatus(s);
    if (!nativeSubscribed) {
      nativeSubscribed = true;
      subscribeNative(apply);
    }
    apply(await nativeStatus());
    return;
  }
  if (typeof navigator === 'undefined') return;
  if (!('storage' in navigator) || !navigator.storage.getDirectory) return;

  const meta = await readMeta();
  useOfflineStore.getState().setHydration({
    downloaded: meta.downloadedPlaylistIds,
    totalBytes: meta.totalBytes,
  });
  await indexWebFiles();

  const root = await getOpfsRoot();
  const playlistsDir = await getDirIfExists(root, [PLAYLISTS_DIR]);
  if (!playlistsDir) return;

  const entries: SwIndexAdd['entries'] = [];
  for (const { name, kind } of await listEntries(playlistsDir)) {
    if (kind !== 'directory') continue;
    const dir = await getDirIfExists(root, [PLAYLISTS_DIR, name]);
    if (!dir) continue;
    const manifest = await readJson<OfflineManifest>(dir, 'manifest.json');
    if (!manifest) continue;
    for (const t of manifest.tracks) {
      entries.push({
        videoId: t.sourceId,
        playlistId: manifest.playlistId,
        audioFilePath: `${PLAYLISTS_DIR}/${manifest.playlistId}/${t.audioFile}`,
      });
    }
  }
  if (entries.length > 0) {
    await notifySwIndex({ type: 'index-add', entries });
  }
}

/** How a browser-storage download went: tracks saved, and tracks skipped
 *  because they could not be fetched or stored. */
export interface DownloadResult {
  saved: number;
  failed: number;
}

/** Saves a playlist for offline playback. Resolves with the counts on the
 *  browser-storage path, or null on Android, where the native plugin only
 *  records the pin and downloads (and counts) in the background. A track
 *  that fails is skipped; only a download that saved nothing rejects. */
export async function downloadPlaylist(playlist: Playlist, tracks: Track[]): Promise<DownloadResult | null> {
  const playable = playableFor(tracks);
  if (playable.length === 0) throw new Error('Playlist is empty');

  if (nativeOfflinePresent()) {
    useOfflineStore.getState().setNativeStatus(await nativePin(playlist.id, playlist.name, playable));
    return null;
  }

  await requestPersistence();

  const store = useOfflineStore.getState();
  store.beginDownload(playlist.id, playable.length);

  const ac = new AbortController();
  aborters.set(playlist.id, ac);

  const root = await getOpfsRoot();
  const playlistDir = await ensureDir(root, [PLAYLISTS_DIR, playlist.id]);
  const audioDir = await ensureDir(playlistDir, ['audio']);
  const artDir = await ensureDir(playlistDir, ['art']);

  const completed: OfflineTrackEntry[] = [];
  let failed = 0;
  let totalBytesThisPlaylist = 0;

  try {
    for (let i = 0; i < playable.length; i++) {
      if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const t = playable[i];
      store.updateProgress(playlist.id, i, t.title);

      // The track's own stream URL, the one the player uses: an upload lives
      // at /api/uploads/<id>/stream, not on the YouTube route.
      const audioFile = `${t.id}.m4a`;
      let bytesAudio: number;
      try {
        const audioRes = await fetch(apiUrl(t.streamUrl), { signal: ac.signal, credentials: 'include' });
        // A signed-out session is answered with the sign-in page: saving that
        // as audio would look like success and only fail at play time.
        if (!audioRes.ok || !audioRes.body || audioRes.headers.get('content-type')?.startsWith('text/html')) {
          throw new Error(`Audio fetch ${audioRes.status} for ${t.title}`);
        }
        bytesAudio = await writeStreamToOpfs(audioDir, audioFile, audioRes.body, ac.signal);
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') throw e;
        // One bad track costs that track, not the tracks already saved.
        failed++;
        continue;
      }

      let artFile: string | null = null;
      let bytesArt = 0;
      if (t.artworkUrl) {
        try {
          const artRes = await fetch(t.artworkUrl, { signal: ac.signal });
          if (artRes.ok && artRes.body) {
            const ext = extFromContentType(artRes.headers.get('content-type'), '.jpg');
            artFile = `${t.id}${ext}`;
            bytesArt = await writeStreamToOpfs(artDir, artFile, artRes.body, ac.signal);
          }
        } catch {
          // Artwork is decorative — skip on failure, keep the track.
        }
      }

      const entry: OfflineTrackEntry = {
        id: t.id,
        sourceId: t.sourceId,
        title: t.title,
        artist: t.artist,
        artistId: t.artistId ?? null,
        album: t.album ?? null,
        durationSec: t.durationSec,
        audioFile: `audio/${audioFile}`,
        artFile: artFile ? `art/${artFile}` : null,
        bytesAudio,
        bytesArt,
      };
      completed.push(entry);
      totalBytesThisPlaylist += bytesAudio + bytesArt;

      // Crash-recovery: rewrite the manifest after every track so an
      // interrupted download leaves a coherent partial state on disk.
      const partialManifest: OfflineManifest = {
        schemaVersion: 1,
        playlistId: playlist.id,
        name: playlist.name,
        artworkFile: null,
        downloadedAt: new Date(0).toISOString(),
        tracks: completed,
      };
      await atomicWriteJson(playlistDir, 'manifest.json', partialManifest);
    }

    if (completed.length === 0) throw new Error('All tracks failed');

    const finalManifest: OfflineManifest = {
      schemaVersion: 1,
      playlistId: playlist.id,
      name: playlist.name,
      artworkFile: null,
      downloadedAt: new Date().toISOString(),
      tracks: completed,
    };
    await atomicWriteJson(playlistDir, 'manifest.json', finalManifest);

    const meta = await readMeta();
    if (!meta.downloadedPlaylistIds.includes(playlist.id)) {
      meta.downloadedPlaylistIds.push(playlist.id);
    }
    meta.totalBytes += totalBytesThisPlaylist;
    await writeMeta(meta);

    store.finishDownload(playlist.id, totalBytesThisPlaylist);
    await indexWebFiles(new Set(completed.map((t) => t.id)));

    await notifySwIndex({
      type: 'index-add',
      entries: completed.map((t) => ({
        videoId: t.sourceId,
        playlistId: playlist.id,
        audioFilePath: `${PLAYLISTS_DIR}/${playlist.id}/${t.audioFile}`,
      })),
    });
    return { saved: completed.length, failed };
  } catch (e) {
    store.failDownload(playlist.id);
    if ((e as Error)?.name === 'AbortError') {
      // Partial state intentionally left for resume.
      return { saved: completed.length, failed };
    }
    const playlistsRoot = await getDirIfExists(root, [PLAYLISTS_DIR]);
    if (playlistsRoot) {
      await deleteEntry(playlistsRoot, playlist.id, { recursive: true }).catch(() => {});
    }
    throw e;
  } finally {
    aborters.delete(playlist.id);
  }
}

/** Pins the Liked songs list for offline playback. Native-only: there's no
 *  OPFS fallback for Liked (it isn't a playlist the web offline flow knows
 *  about), and the button that calls this is itself gated on the plugin's
 *  presence. */
export const pinLiked = (tracks: Track[]) => pinList(LIKED_PIN, 'Liked songs', tracks);

export async function removeDownload(playlistId: string): Promise<void> {
  if (nativeOfflinePresent()) {
    useOfflineStore.getState().setNativeStatus(await nativeUnpin(playlistId));
    return;
  }
  const root = await getOpfsRoot();
  const playlistsDir = await getDirIfExists(root, [PLAYLISTS_DIR]);
  if (!playlistsDir) return;

  const playlistDir = await getDirIfExists(root, [PLAYLISTS_DIR, playlistId]);
  let bytesRemoved = 0;
  let videoIds: string[] = [];
  if (playlistDir) {
    const manifest = await readJson<OfflineManifest>(playlistDir, 'manifest.json');
    if (manifest) {
      bytesRemoved = manifest.tracks.reduce((sum, t) => sum + t.bytesAudio + t.bytesArt, 0);
      videoIds = manifest.tracks.map((t) => t.sourceId);
    }
  }

  if (videoIds.length > 0) {
    await notifySwIndex({ type: 'index-remove', videoIds });
  }
  await deleteEntry(playlistsDir, playlistId, { recursive: true });

  const meta = await readMeta();
  meta.downloadedPlaylistIds = meta.downloadedPlaylistIds.filter((id) => id !== playlistId);
  meta.totalBytes = Math.max(0, meta.totalBytes - bytesRemoved);
  await writeMeta(meta);

  useOfflineStore.getState().removeDownload(playlistId, bytesRemoved);
  await indexWebFiles();
}

export function cancelDownload(playlistId: string): void {
  if (nativeOfflinePresent()) {
    void nativeCancel(playlistId).then((s) => useOfflineStore.getState().setNativeStatus(s));
    return;
  }
  const ac = aborters.get(playlistId);
  ac?.abort();
}

/** Whether the live playlist contents diverge from what's downloaded. */
export async function isStale(playlistId: string, liveTrackIds: string[]): Promise<boolean> {
  if (nativeOfflinePresent()) {
    const pin = useOfflineStore.getState().pins.find((p) => p.id === playlistId);
    if (!pin) return false;
    if (pin.trackIds.length !== liveTrackIds.length) return true;
    const ps = new Set(pin.trackIds);
    return !liveTrackIds.every((id) => ps.has(id));
  }
  const root = await getOpfsRoot();
  const dir = await getDirIfExists(root, [PLAYLISTS_DIR, playlistId]);
  if (!dir) return false;
  const manifest = await readJson<OfflineManifest>(dir, 'manifest.json');
  if (!manifest) return false;
  const downloadedIds = manifest.tracks.map((t) => t.id);
  if (downloadedIds.length !== liveTrackIds.length) return true;
  const ds = new Set(downloadedIds);
  return !liveTrackIds.every((id) => ds.has(id));
}

export async function clearAllDownloads(): Promise<void> {
  if (nativeOfflinePresent()) {
    useOfflineStore.getState().setNativeStatus(await nativeClearAll());
    return;
  }
  const root = await getOpfsRoot();
  await deleteEntry(root, PLAYLISTS_DIR, { recursive: true });
  await deleteEntry(root, META_FILE);
  await notifySwIndex({ type: 'index-remove', videoIds: '*' });
  useOfflineStore.setState({ downloaded: [], totalBytes: 0, inFlight: {} });
  await indexWebFiles();
}
