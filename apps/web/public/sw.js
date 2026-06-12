// Service worker for Ember PWA. Network-first for the HTML shell so deploys
// pick up immediately; cache-first for fingerprinted assets; offline-aware
// for /api/youtube/stream/<videoId> requests when the user has pinned a
// playlist for offline playback (see offline-playback design spec).

const CACHE = 'ember-shell-v6';
const SHELL = ['/', '/index.html', '/manifest.webmanifest'];
const STREAM_RE = /^\/api\/youtube\/stream\/([A-Za-z0-9_-]{11})(?:\/|$|\?)/;
const NETWORK_TIMEOUT_MS = 3000;

// videoId → { playlistId, audioFilePath } — populated by hydrate + messages.
const OFFLINE_INDEX = new Map();

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
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
  if (url.pathname.startsWith('/api/')) return;
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== 'GET') return;

  const isNavigation = e.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html';
  if (isNavigation) {
    e.respondWith(
      fetch(e.request).then((resp) => {
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return resp;
      }).catch(() => caches.match(e.request).then((r) => r ?? caches.match('/index.html'))),
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((resp) => {
        if (!resp || resp.status !== 200 || resp.type !== 'basic') return resp;
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return resp;
      });
    }),
  );
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
