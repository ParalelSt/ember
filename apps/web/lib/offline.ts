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
  readJson,
  requestPersistence,
  writeStreamToOpfs,
} from '@/lib/opfs';
import { apiUrl } from '@/lib/api';

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

/** Hydrates the offline store from OPFS at app boot. Idempotent. */
export async function hydrateOfflineStore(): Promise<void> {
  if (typeof navigator === 'undefined') return;
  if (!('storage' in navigator) || !navigator.storage.getDirectory) return;

  const meta = await readMeta();
  useOfflineStore.getState().setHydration({
    downloaded: meta.downloadedPlaylistIds,
    totalBytes: meta.totalBytes,
  });

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

export async function downloadPlaylist(playlist: Playlist, tracks: Track[]): Promise<void> {
  if (tracks.length === 0) throw new Error('Playlist is empty');

  await requestPersistence();

  const store = useOfflineStore.getState();
  store.beginDownload(playlist.id, tracks.length);

  const ac = new AbortController();
  aborters.set(playlist.id, ac);

  const root = await getOpfsRoot();
  const playlistDir = await ensureDir(root, [PLAYLISTS_DIR, playlist.id]);
  const audioDir = await ensureDir(playlistDir, ['audio']);
  const artDir = await ensureDir(playlistDir, ['art']);

  const completed: OfflineTrackEntry[] = [];
  let totalBytesThisPlaylist = 0;

  try {
    for (let i = 0; i < tracks.length; i++) {
      if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const t = tracks[i];
      store.updateProgress(playlist.id, i, t.title);

      const audioRes = await fetch(
        apiUrl(`/api/youtube/stream/${encodeURIComponent(t.sourceId)}`),
        { signal: ac.signal, credentials: 'include' },
      );
      if (!audioRes.ok || !audioRes.body) {
        throw new Error(`Audio fetch ${audioRes.status} for ${t.title}`);
      }
      const audioFile = `${t.id}.m4a`;
      const bytesAudio = await writeStreamToOpfs(audioDir, audioFile, audioRes.body, ac.signal);

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

    await notifySwIndex({
      type: 'index-add',
      entries: completed.map((t) => ({
        videoId: t.sourceId,
        playlistId: playlist.id,
        audioFilePath: `${PLAYLISTS_DIR}/${playlist.id}/${t.audioFile}`,
      })),
    });
  } catch (e) {
    store.failDownload(playlist.id);
    if ((e as Error)?.name === 'AbortError') {
      // Partial state intentionally left for resume.
      return;
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

export async function removeDownload(playlistId: string): Promise<void> {
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
}

export function cancelDownload(playlistId: string): void {
  const ac = aborters.get(playlistId);
  ac?.abort();
}

/** Whether the live playlist contents diverge from what's downloaded. */
export async function isStale(playlistId: string, liveTrackIds: string[]): Promise<boolean> {
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
  const root = await getOpfsRoot();
  await deleteEntry(root, PLAYLISTS_DIR, { recursive: true });
  await deleteEntry(root, META_FILE);
  await notifySwIndex({ type: 'index-remove', videoIds: '*' });
  useOfflineStore.setState({ downloaded: [], totalBytes: 0, inFlight: {} });
}
