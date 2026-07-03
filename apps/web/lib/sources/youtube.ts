import 'server-only';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import type { Track } from '@/types/track';
import { serverLogger } from '@/lib/logger/server';

// apps/web is one level deeper than the old apps/api in workspace layout,
// but both resolve to the same spotify-clone root.
const ROOT = path.resolve(process.cwd(), '..', '..');

const PYTHON_BIN = process.env.PYTHON_BIN ?? path.join(ROOT, '.venv/bin/python');
const PLAYER_SCRIPT = process.env.PLAYER_SCRIPT ?? path.join(ROOT, 'player.py');
const MUSIC_DIR = process.env.MUSIC_DIR ?? path.join(ROOT, 'my_music');

const CACHE_EXTS = ['.m4a', '.webm', '.opus', '.mp3', '.mp4'] as const;

export function findCachedFile(videoId: string): string | null {
  for (const ext of CACHE_EXTS) {
    const p = path.join(MUSIC_DIR, `${videoId}${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

interface PythonError extends Error {
  status?: number;
}

// Prepend the venv's bin/ to PATH so yt-dlp can find ffmpeg installed via
// `pip install imageio-ffmpeg` (which symlinks into .venv/bin). Without this,
// yt-dlp downloads fragmented DASH MP4s that <audio> elements refuse.
const VENV_BIN = path.dirname(PYTHON_BIN);
const SUBPROCESS_PATH = `${VENV_BIN}:${process.env.PATH ?? ''}`;

function runPython<T = unknown>(args: string[], { timeoutMs = 30000 } = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [PLAYER_SCRIPT, ...args], {
      env: { ...process.env, MUSIC_DIR, PATH: SUBPROCESS_PATH },
    });
    let stdout = '';
    let stderr = '';
    const reject_ = (e: PythonError) => {
      serverLogger.error('python', e.message, { args, stderr: stderr.slice(-200) }, e);
      reject(e);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      const e: PythonError = new Error('python timed out');
      e.status = 504;
      reject_(e);
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    // Buffer stderr for error reporting AND forward live to Node's stderr so
    // `[search] …` / yt-dlp logs surface in the dev/prod terminal as they
    // happen — not just when the process fails.
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      process.stderr.write(d);
    });
    child.on('error', (e) => { clearTimeout(timer); reject_(e as PythonError); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const e: PythonError = new Error(stderr.slice(-500) || `python exited ${code}`);
        e.status = 502;
        return reject_(e);
      }
      try {
        resolve(JSON.parse(stdout) as T);
      } catch {
        // Include the args that triggered this so the next "bad python output"
        // log tells us which call actually failed (info vs. search vs. …).
        const e: PythonError = new Error(`bad python output for [${args.join(' ')}]: ${stdout.slice(0, 200)}`);
        e.status = 502;
        reject_(e);
      }
    });
  });
}

interface RawYoutubeTrack {
  videoId: string;
  title: string;
  artist: string;
  artistId?: string | null;
  album?: string | null;
  albumId?: string | null;
  durationSec?: number;
  artworkUrl: string;
}

function normalize(t: RawYoutubeTrack): Track {
  return {
    id: `youtube:${t.videoId}`,
    sourceId: t.videoId,
    source: 'youtube',
    title: t.title,
    artist: t.artist,
    artistId: t.artistId ?? null,
    album: t.album ?? null,
    albumId: t.albumId ?? null,
    durationSec: t.durationSec ?? 0,
    artworkUrl: t.artworkUrl,
    streamUrl: `/api/youtube/stream/${t.videoId}`,
  };
}

function dedupeByVideoId(tracks: RawYoutubeTrack[]): RawYoutubeTrack[] {
  const seen = new Set<string>();
  return tracks.filter((t) => {
    if (!t.videoId || seen.has(t.videoId)) return false;
    seen.add(t.videoId);
    return true;
  });
}

const SEARCH_CACHE = new Map<string, { tracks: Track[]; expires: number }>();
const SEARCH_TTL_MS = 5 * 60 * 1000;
const SEARCH_CACHE_MAX = 100;

export async function searchTracks(query: string, { limit = 30 } = {}): Promise<Track[]> {
  const key = `${query}:${limit}`;
  const hit = SEARCH_CACHE.get(key);
  if (hit && hit.expires > Date.now()) return hit.tracks;

  // `--` separates flags from positionals so a query string that starts with
  // `-` doesn't get misparsed as a flag by argparse. Flags come first.
  const results = await runPython<RawYoutubeTrack[]>(['search', '--limit', String(limit), '--', query]);
  const tracks = dedupeByVideoId(results).map(normalize);

  // Bound the cache. Drop the oldest insertion when we hit the cap — Map
  // iteration order is insertion order in JS. Not strict LRU (we don't
  // bump on hit) but TTL evicts stale entries anyway, and the cap of 100
  // keeps total memory in the low-MB range.
  if (SEARCH_CACHE.size >= SEARCH_CACHE_MAX) {
    const oldest = SEARCH_CACHE.keys().next().value;
    if (oldest !== undefined) SEARCH_CACHE.delete(oldest);
  }
  SEARCH_CACHE.set(key, { tracks, expires: Date.now() + SEARCH_TTL_MS });

  return tracks;
}

export async function ensureDownloaded(videoId: string): Promise<string> {
  if (!VIDEO_ID_RE.test(videoId)) {
    const e: PythonError = new Error('invalid videoId');
    e.status = 400;
    throw e;
  }
  const result = await runPython<{ filePath: string }>(['download', '--', videoId], { timeoutMs: 180000 });
  return result.filePath;
}

/** Resolve a single videoId to track metadata via ytmusicapi get_song.
 *  Returns null when the video doesn't exist / is private. Used by the
 *  shareable /track/<videoId> page for ids not yet in PocketBase. */
export async function getTrack(videoId: string): Promise<Track | null> {
  if (!VIDEO_ID_RE.test(videoId)) {
    const e: PythonError = new Error('invalid videoId');
    e.status = 400;
    throw e;
  }
  const raw = await runPython<RawYoutubeTrack & { error?: string }>(
    ['track', '--', videoId],
    { timeoutMs: 20000 },
  );
  if (!raw || raw.error || !raw.videoId) return null;
  return normalize(raw);
}

export async function getTrending({ country = 'ZZ' } = {}): Promise<Track[]> {
  const safeCountry = String(country).slice(0, 2).toUpperCase().replace(/[^A-Z]/g, '') || 'ZZ';
  const results = await runPython<RawYoutubeTrack[]>(['trending', '--country', safeCountry]);
  return dedupeByVideoId(results).map(normalize);
}

interface RecommendedArgs {
  seed?: string;
  country?: string;
  limit?: number;
}

export async function getRecommended({ seed, country = 'ZZ', limit = 30 }: RecommendedArgs = {}): Promise<Track[]> {
  const args = ['recommended', '--country', country, '--limit', String(limit)];
  if (seed && VIDEO_ID_RE.test(seed)) args.push('--seed', seed);
  const results = await runPython<RawYoutubeTrack[]>(args);
  return dedupeByVideoId(results).map(normalize);
}

interface RawArtist {
  name?: string;
  description?: string | null;
  thumbnails?: { url: string }[];
  tracks?: RawYoutubeTrack[];
  albums?: unknown[];
  singles?: unknown[];
  error?: string;
}

interface RawAlbumDetail {
  title?: string;
  artist?: string;
  artistId?: string | null;
  year?: number | null;
  thumbnails?: { url: string; width?: number; height?: number }[];
  trackCount?: number;
  totalDurationSec?: number;
  tracks?: RawYoutubeTrack[];
  error?: string;
}

const ALBUM_ID_RE = /^[A-Za-z0-9_-]{8,40}$/;

export async function getAlbum(browseId: string) {
  if (!ALBUM_ID_RE.test(browseId)) {
    const e: PythonError = new Error('invalid albumId');
    e.status = 400;
    throw e;
  }
  const result = await runPython<RawAlbumDetail>(['album', '--', browseId], { timeoutMs: 30000 });
  if (result?.error) {
    const e: PythonError = new Error(result.error);
    e.status = 502;
    throw e;
  }
  return {
    title: result?.title ?? 'Album',
    artist: result?.artist ?? 'Unknown',
    artistId: result?.artistId ?? null,
    year: result?.year ?? null,
    thumbnails: result?.thumbnails ?? [],
    trackCount: result?.trackCount ?? 0,
    totalDurationSec: result?.totalDurationSec ?? 0,
    tracks: (result?.tracks ?? []).filter((t) => t.videoId).map(normalize),
  };
}

const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{10,60}$/;

interface RawYtPlaylist {
  title?: string;
  tracks?: RawYoutubeTrack[];
  error?: string;
}

/** Public YT Music playlist → name + normalized tracks (playlist import). */
export async function getYtPlaylist(playlistId: string): Promise<{ name: string; tracks: Track[] }> {
  if (!PLAYLIST_ID_RE.test(playlistId)) {
    const e: PythonError = new Error('invalid playlistId');
    e.status = 400;
    throw e;
  }
  const result = await runPython<RawYtPlaylist>(['ytplaylist', '--', playlistId], { timeoutMs: 60000 });
  if (result?.error) {
    const e: PythonError = new Error(
      "Couldn't open that playlist — it must be a public YouTube Music playlist.",
    );
    e.status = 404;
    throw e;
  }
  return {
    name: result?.title ?? 'Imported playlist',
    tracks: dedupeByVideoId(result?.tracks ?? []).map(normalize),
  };
}

interface RawMatchResult {
  results?: (RawYoutubeTrack | null)[];
}

/** Match {title, artist} items (≤8 per call) onto YT Music songs; null = miss. */
export async function matchTracks(items: { title: string; artist: string }[]): Promise<(Track | null)[]> {
  if (!items.length) return [];
  const queries = items.map((i) => `${i.title}\t${i.artist}`);
  const result = await runPython<RawMatchResult>(['match', '--', ...queries], { timeoutMs: 60000 });
  return (result?.results ?? []).map((r) => (r && r.videoId ? normalize(r) : null));
}

export async function getArtist(channelId: string) {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(channelId)) {
    const e: PythonError = new Error('invalid artistId');
    e.status = 400;
    throw e;
  }
  const result = await runPython<RawArtist>(['artist', '--', channelId], { timeoutMs: 30000 });
  if (result?.error) {
    const e: PythonError = new Error(result.error);
    e.status = 502;
    throw e;
  }
  return {
    name: result?.name ?? 'Artist',
    description: result?.description ?? null,
    thumbnails: result?.thumbnails ?? [],
    tracks: (result?.tracks ?? []).filter((t) => t.videoId).map(normalize),
    albums: result?.albums ?? [],
    singles: result?.singles ?? [],
  };
}

interface StreamInfo {
  url: string;
  ext?: string;
  /** Headers yt-dlp used to resolve the format URL (notably User-Agent). The
   *  proxy must replay these when fetching googlevideo or it gets a 403. */
  httpHeaders?: Record<string, string>;
}

const URL_CACHE = new Map<string, { info: StreamInfo; expires: number }>();
const URL_TTL_MS = 5 * 60 * 1000;

interface RawLyrics {
  lyrics?: string | null;
  source?: 'genius' | 'none';
  url?: string;
  error?: string;
}

export interface LyricsLine {
  /** Seconds from the start of the track. */
  time: number;
  text: string;
}

export interface LyricsResult {
  lyrics: string | null;
  source: 'genius' | 'lrclib' | 'none';
  url: string | null;
  /** Time-synced lines when the source provides them. Empty/undefined
   *  means we only have plain text — the UI renders it as a single block. */
  synced?: LyricsLine[];
}

const LYRICS_CACHE = new Map<string, { result: LyricsResult; expires: number }>();
const LYRICS_TTL_MS = 60 * 60 * 1000;

/** Parse LRC body into sorted {time, text} entries. Tolerates the common
 *  `[mm:ss.xx]` and `[mm:ss]` forms, multiple stamps per line, and metadata
 *  tags like `[ar:...]`/`[ti:...]` which we silently skip. */
function parseLRC(body: string): LyricsLine[] {
  const stampRe = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  const lines: LyricsLine[] = [];
  for (const raw of body.split('\n')) {
    const stamps: number[] = [];
    let lastEnd = 0;
    let m: RegExpExecArray | null;
    stampRe.lastIndex = 0;
    while ((m = stampRe.exec(raw)) !== null) {
      const mm = Number(m[1]);
      const ss = Number(m[2]);
      const frac = m[3] ? Number(m[3]) / 10 ** m[3].length : 0;
      stamps.push(mm * 60 + ss + frac);
      lastEnd = stampRe.lastIndex;
    }
    if (stamps.length === 0) continue;
    const text = raw.slice(lastEnd).trim();
    for (const t of stamps) lines.push({ time: t, text });
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

interface RawLrclibHit {
  id?: number;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  instrumental?: boolean;
}

/** YouTube titles arrive with cruft like "(Official Music Video)" or
 *  "feat. X" that LRCLib's matcher trips over. Strip the noise so a track
 *  like "Until the World Goes Cold (Official Music Video)" looks up as
 *  just "Until the World Goes Cold". */
function cleanForLyricsLookup(s: string): string {
  return s
    .replace(/\s*[\[(][^\])]*\b(official|lyric|lyrics|music|audio|video|hd|hq|4k|live|remaster(ed)?|visualizer|mv|m\/v)\b[^\])]*[\])]/gi, '')
    .replace(/\s*[-–—]\s*(official|lyric|lyrics|music|audio|video|hd|hq|4k|live|remaster(ed)?)\b.*$/i, '')
    .replace(/\s*[\[(]?\bfeat(?:uring)?\.?\b[^)\]]*[\])]?/gi, '')
    .replace(/\s*[\[(]?\bft\.\b[^)\]]*[\])]?/gi, '')
    .replace(/\s+VEVO\b/gi, '')
    .replace(/\s+-\s+Topic\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** LRCLib is a community database that returns both `syncedLyrics` (LRC
 *  format) and `plainLyrics` for a track. No auth, no rate limits to speak
 *  of. We try it first because it's the only source we have with timing
 *  info — falling back to Genius (via the Python scraper) only when LRCLib
 *  has nothing.
 *
 *  Uses /api/search (fuzzy) rather than /api/get (exact) because YouTube
 *  metadata almost never matches LRCLib's clean artist/title strings. */
async function fetchLrclib(title: string, artist: string): Promise<LyricsResult | null> {
  const cleanTitle = cleanForLyricsLookup(title);
  const cleanArtist = cleanForLyricsLookup(artist);
  const params = new URLSearchParams({ track_name: cleanTitle });
  if (cleanArtist) params.set('artist_name', cleanArtist);
  const url = `https://lrclib.net/api/search?${params.toString()}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': 'Ember (+https://github.com/ParalelSt/ember)' },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const hits = (await res.json().catch(() => null)) as RawLrclibHit[] | null;
  if (!Array.isArray(hits) || hits.length === 0) return null;

  // Prefer a hit that actually has synced lyrics — that's the whole point
  // of going to LRCLib. Fall back to the first hit otherwise.
  const hit =
    hits.find((h) => !h.instrumental && h.syncedLyrics && h.syncedLyrics.trim().length > 0)
    ?? hits.find((h) => !h.instrumental && h.plainLyrics);
  if (!hit) return null;

  const synced = hit.syncedLyrics ? parseLRC(hit.syncedLyrics) : [];
  const plain = (hit.plainLyrics ?? '').trim()
    || (synced.length ? synced.map((l) => l.text).join('\n') : '');
  if (!plain && synced.length === 0) return null;
  return {
    lyrics: plain || null,
    source: 'lrclib',
    url: null,
    synced: synced.length ? synced : undefined,
  };
}

export async function getLyrics(title: string, artist: string): Promise<LyricsResult> {
  const cleanTitle = title.trim().slice(0, 200);
  const cleanArtist = artist.trim().slice(0, 200);
  if (!cleanTitle) {
    const e: PythonError = new Error('missing title');
    e.status = 400;
    throw e;
  }
  // v2 = LRCLib (synced) path added. Bumping ensures any v1-era cached
  // entries (Genius-only, no `synced`) don't shadow newer lookups.
  const cacheKey = `v2:${cleanArtist}::${cleanTitle}`.toLowerCase();
  const cached = LYRICS_CACHE.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.result;

  // Prefer LRCLib because it can give us synced timing. If it has nothing
  // useful, fall back to Genius via the Python scraper for the plain text.
  const fromLrclib = await fetchLrclib(cleanTitle, cleanArtist);
  if (fromLrclib) {
    LYRICS_CACHE.set(cacheKey, { result: fromLrclib, expires: Date.now() + LYRICS_TTL_MS });
    return fromLrclib;
  }

  const raw = await runPython<RawLyrics>(['lyrics', '--', cleanTitle, cleanArtist], { timeoutMs: 20000 });
  if (raw?.error) {
    const e: PythonError = new Error(raw.error);
    e.status = 502;
    throw e;
  }
  const result: LyricsResult = {
    lyrics: raw?.lyrics ?? null,
    source: raw?.source ?? 'none',
    url: raw?.url ?? null,
  };
  LYRICS_CACHE.set(cacheKey, { result, expires: Date.now() + LYRICS_TTL_MS });
  return result;
}

export async function resolveStreamUrl(videoId: string): Promise<StreamInfo> {
  if (!VIDEO_ID_RE.test(videoId)) {
    const e: PythonError = new Error('invalid videoId');
    e.status = 400;
    throw e;
  }
  const cached = URL_CACHE.get(videoId);
  if (cached && cached.expires > Date.now()) return cached.info;
  const info = await runPython<StreamInfo>(['info', '--', videoId], { timeoutMs: 30000 });
  if (!info?.url) {
    const e: PythonError = new Error('no upstream URL');
    e.status = 502;
    throw e;
  }
  URL_CACHE.set(videoId, { info, expires: Date.now() + URL_TTL_MS });
  return info;
}
