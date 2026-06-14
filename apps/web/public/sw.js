// Service worker for Ember PWA — intentionally MINIMAL.
//
// It exists for two reasons only:
//   1. Be registered with a fetch handler so the PWA is installable.
//   2. Serve pinned offline tracks from OPFS for /api/youtube/stream/<id>.
//
// It does NOT cache app assets. Cache-first asset caching repeatedly served
// stale / broken JS, images and icons after rebuilds (start-static.sh churns
// fingerprinted files constantly), so all non-stream requests now go straight
// to the network (browser default). Offline app-shell loading is deferred to
// the native app along with the rest of offline playback.

const STREAM_RE = /^\/api\/youtube\/stream\/([A-Za-z0-9_-]{11})(?:\/|$|\?)/;
const NETWORK_TIMEOUT_MS = 3000;

// videoId → { playlistId, audioFilePath } — populated by hydrate + messages.
const OFFLINE_INDEX = new Map();

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Delete ALL old caches (including the poisoned v4–v7 asset caches that
    // were breaking images/icons). We no longer use the Cache API at all.
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await rebuildOfflineIndex().catch(() => {});
    await sweepOrphans().catch(() => {});
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  const data = e.data;
  if (!data) return;
  if (data.type === 'index-add' && Array.isArray(data.entries)) {
    for (const entry of data.entries) {
      if (entry && entry.videoId && entry.audioFilePath) {
        OFFLINE_INDEX.set(entry.videoId, {
          playlistId: entry.playlistId,
          audioFilePath: entry.audioFilePath,
        });
      }
    }
  } else if (data.type === 'index-remove') {
    if (data.videoIds === '*') OFFLINE_INDEX.clear();
    else if (Array.isArray(data.videoIds)) for (const id of data.videoIds) OFFLINE_INDEX.delete(id);
  }
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const streamMatch = STREAM_RE.exec(url.pathname);
  if (streamMatch && e.request.method === 'GET') {
    e.respondWith(streamWithOfflineFallback(e.request, streamMatch[1]));
    return;
  }
  // Everything else → browser default. No caching of any kind.
});

// ─────────── Offline playback helpers ───────────

async function streamWithOfflineFallback(request, videoId) {
  const entry = OFFLINE_INDEX.get(videoId);
  if (!entry) {
    console.log(`[sw] ${videoId} pass-through (not pinned) → backend`);
    return fetch(request);
  }

  try {
    const resp = await Promise.race([
      fetch(request),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), NETWORK_TIMEOUT_MS)),
    ]);
    if (resp && resp.ok) {
      console.log(`[sw] ${videoId} network-win → backend (pinned, online)`);
      return resp;
    }
    throw new Error('non-ok');
  } catch {
    console.log(`[sw] ${videoId} OPFS fallback → your PC (offline / network failed)`);
    return serveFromOpfs(entry, request);
  }
}

async function serveFromOpfs(entry, request) {
  const file = await readOpfsFileByPath(entry.audioFilePath);
  if (!file) {
    return new Response('Offline copy missing', { status: 410 });
  }
  const rangeHeader = request.headers.get('range');
  if (rangeHeader) return buildPartialContent(file, rangeHeader);
  return new Response(file.stream(), {
    headers: {
      'Content-Type': 'audio/mp4',
      'Content-Length': String(file.size),
      'Accept-Ranges': 'bytes',
    },
  });
}

function buildPartialContent(file, rangeHeader) {
  const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
  if (!match) return new Response(file.stream(), { status: 200 });
  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : file.size - 1;
  const safeEnd = Math.min(end, file.size - 1);
  if (start > safeEnd) {
    return new Response('Bad range', { status: 416 });
  }
  const slice = file.slice(start, safeEnd + 1);
  return new Response(slice.stream(), {
    status: 206,
    headers: {
      'Content-Type': 'audio/mp4',
      'Content-Length': String(slice.size),
      'Content-Range': `bytes ${start}-${safeEnd}/${file.size}`,
      'Accept-Ranges': 'bytes',
    },
  });
}

async function readOpfsFileByPath(path) {
  if (!navigator.storage || !navigator.storage.getDirectory) return null;
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  let dir = await navigator.storage.getDirectory();
  for (let i = 0; i < segments.length - 1; i++) {
    try {
      dir = await dir.getDirectoryHandle(segments[i], { create: false });
    } catch {
      return null;
    }
  }
  try {
    const handle = await dir.getFileHandle(segments[segments.length - 1], { create: false });
    return await handle.getFile();
  } catch {
    return null;
  }
}

async function rebuildOfflineIndex() {
  if (!navigator.storage || !navigator.storage.getDirectory) return;
  const root = await navigator.storage.getDirectory();
  let playlistsDir;
  try {
    playlistsDir = await root.getDirectoryHandle('playlists', { create: false });
  } catch {
    return;
  }
  for await (const [playlistId, dirHandle] of playlistsDir.entries()) {
    if (dirHandle.kind !== 'directory') continue;
    try {
      const manifestHandle = await dirHandle.getFileHandle('manifest.json', { create: false });
      const file = await manifestHandle.getFile();
      const text = await file.text();
      const manifest = JSON.parse(text);
      if (!manifest || !Array.isArray(manifest.tracks)) continue;
      for (const t of manifest.tracks) {
        if (t && t.sourceId && t.audioFile) {
          OFFLINE_INDEX.set(t.sourceId, {
            playlistId,
            audioFilePath: `playlists/${playlistId}/${t.audioFile}`,
          });
        }
      }
    } catch {
      // Unreadable manifest — skip.
    }
  }
}

async function sweepOrphans() {
  if (!navigator.storage || !navigator.storage.getDirectory) return;
  const root = await navigator.storage.getDirectory();
  let metaIds = null;
  try {
    const metaHandle = await root.getFileHandle('meta.json', { create: false });
    const file = await metaHandle.getFile();
    const meta = JSON.parse(await file.text());
    metaIds = new Set((meta && meta.downloadedPlaylistIds) || []);
  } catch {
    return;
  }
  let playlistsDir;
  try {
    playlistsDir = await root.getDirectoryHandle('playlists', { create: false });
  } catch {
    return;
  }
  for await (const [name, handle] of playlistsDir.entries()) {
    if (handle.kind === 'directory' && !metaIds.has(name)) {
      await playlistsDir.removeEntry(name, { recursive: true }).catch(() => {});
    }
  }
}
