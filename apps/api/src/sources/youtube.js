import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// apps/api/src/sources -> spotify-clone
const ROOT = path.resolve(__dirname, '../../../../');

const PYTHON_BIN = process.env.PYTHON_BIN ?? path.join(ROOT, '.venv/bin/python');
const PLAYER_SCRIPT = process.env.PLAYER_SCRIPT ?? path.join(ROOT, 'player.py');
const MUSIC_DIR = process.env.MUSIC_DIR ?? path.join(ROOT, 'my_music');

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function runPython(args, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [PLAYER_SCRIPT, ...args], {
      env: { ...process.env, MUSIC_DIR },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(Object.assign(new Error('python timed out'), { status: 504 }));
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(Object.assign(
          new Error(stderr.slice(-500) || `python exited ${code}`),
          { status: 502 },
        ));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(Object.assign(
          new Error(`bad python output: ${stdout.slice(0, 200)}`),
          { status: 502 },
        ));
      }
    });
  });
}

function normalize(t) {
  return {
    id: `youtube:${t.videoId}`,
    sourceId: t.videoId,
    source: 'youtube',
    title: t.title,
    artist: t.artist,
    album: t.album ?? null,
    durationSec: t.durationSec ?? 0,
    artworkUrl: t.artworkUrl,
    streamUrl: `/api/youtube/stream/${t.videoId}`,
  };
}

export async function searchTracks(query, { limit = 30 } = {}) {
  const results = await runPython(['search', query, '--limit', String(limit)]);
  return results.filter(t => t.videoId).map(normalize);
}

export async function ensureDownloaded(videoId) {
  if (!VIDEO_ID_RE.test(videoId)) {
    throw Object.assign(new Error('invalid videoId'), { status: 400 });
  }
  const result = await runPython(['download', videoId], { timeoutMs: 180000 });
  return result.filePath;
}

export async function getTrending({ country = 'ZZ' } = {}) {
  const safeCountry = String(country).slice(0, 2).toUpperCase().replace(/[^A-Z]/g, '') || 'ZZ';
  const results = await runPython(['trending', '--country', safeCountry]);
  return results.filter(t => t.videoId).map(normalize);
}
