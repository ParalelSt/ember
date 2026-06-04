import 'server-only';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import type { Track } from '@/types/track';

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
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      const e: PythonError = new Error('python timed out');
      e.status = 504;
      reject(e);
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const e: PythonError = new Error(stderr.slice(-500) || `python exited ${code}`);
        e.status = 502;
        return reject(e);
      }
      try {
        resolve(JSON.parse(stdout) as T);
      } catch {
        // Include the args that triggered this so the next "bad python output"
        // log tells us which call actually failed (info vs. search vs. …).
        const e: PythonError = new Error(`bad python output for [${args.join(' ')}]: ${stdout.slice(0, 200)}`);
        e.status = 502;
        reject(e);
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

export async function searchTracks(query: string, { limit = 30 } = {}): Promise<Track[]> {
  const results = await runPython<RawYoutubeTrack[]>(['search', query, '--limit', String(limit)]);
  return dedupeByVideoId(results).map(normalize);
}

export async function ensureDownloaded(videoId: string): Promise<string> {
  if (!VIDEO_ID_RE.test(videoId)) {
    const e: PythonError = new Error('invalid videoId');
    e.status = 400;
    throw e;
  }
  const result = await runPython<{ filePath: string }>(['download', videoId], { timeoutMs: 180000 });
  return result.filePath;
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
  error?: string;
}

export async function getArtist(channelId: string) {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(channelId)) {
    const e: PythonError = new Error('invalid artistId');
    e.status = 400;
    throw e;
  }
  const result = await runPython<RawArtist>(['artist', channelId], { timeoutMs: 30000 });
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
  };
}

interface StreamInfo {
  url: string;
  ext?: string;
}

const URL_CACHE = new Map<string, { info: StreamInfo; expires: number }>();
const URL_TTL_MS = 5 * 60 * 1000;

export async function resolveStreamUrl(videoId: string): Promise<StreamInfo> {
  if (!VIDEO_ID_RE.test(videoId)) {
    const e: PythonError = new Error('invalid videoId');
    e.status = 400;
    throw e;
  }
  const cached = URL_CACHE.get(videoId);
  if (cached && cached.expires > Date.now()) return cached.info;
  const info = await runPython<StreamInfo>(['info', videoId], { timeoutMs: 30000 });
  if (!info?.url) {
    const e: PythonError = new Error('no upstream URL');
    e.status = 502;
    throw e;
  }
  URL_CACHE.set(videoId, { info, expires: Date.now() + URL_TTL_MS });
  return info;
}
