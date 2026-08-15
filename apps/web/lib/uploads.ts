import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type PocketBase from 'pocketbase';
import type { RecordModel } from 'pocketbase';
import type { Track } from '@/types/track';

/** Member-uploaded songs.
 *
 *  The audio sits on disk beside the cached YouTube audio (MUSIC_DIR/uploads)
 *  rather than inside PocketBase, so the same backup/disk story covers both
 *  and PB's database stays small. The `uploads` collection holds metadata and
 *  the filename that points into that directory. */

// apps/web is two directories deep in the workspace.
const ROOT = path.resolve(process.cwd(), '..', '..');
const MUSIC_DIR = process.env.MUSIC_DIR ?? path.join(ROOT, 'my_music');
export const UPLOAD_DIR = path.join(MUSIC_DIR, 'uploads');

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB ?? 50) * 1024 * 1024;

/** Accepted audio types → canonical extension. Anything else is rejected:
 *  this directory is served back to every member, so it holds audio only. */
export const ALLOWED_TYPES: Record<string, string> = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.m4a',
  'audio/flac': '.flac',
  'audio/x-flac': '.flac',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/webm': '.webm',
};

export const MIME_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
};

/** Magic-byte sniff. A browser-supplied Content-Type is a claim, not a fact,
 *  and this file gets streamed back to everyone — so check the bytes too.
 *  Returns the detected extension, or null if it doesn't look like audio. */
export function sniffAudio(buf: Buffer): string | null {
  const ascii = (start: number, len: number) => buf.subarray(start, start + len).toString('ascii');
  if (buf.length < 12) return null;
  if (ascii(0, 3) === 'ID3') return '.mp3';
  // MPEG audio frame sync (11 set bits).
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return '.mp3';
  if (ascii(4, 4) === 'ftyp') return '.m4a';
  if (ascii(0, 4) === 'fLaC') return '.flac';
  if (ascii(0, 4) === 'OggS') return '.ogg';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return '.wav';
  // Matroska/WebM.
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return '.webm';
  return null;
}

/** Random name — never the user's filename, which could carry path
 *  separators or a misleading extension. */
export function newFilename(ext: string): string {
  return `${crypto.randomBytes(12).toString('hex')}${ext}`;
}

/** Resolves a stored filename to an absolute path, refusing anything that
 *  escapes UPLOAD_DIR. */
export function resolveUploadPath(filename: string): string | null {
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) return null;
  const full = path.join(UPLOAD_DIR, filename);
  if (path.dirname(path.resolve(full)) !== path.resolve(UPLOAD_DIR)) return null;
  return full;
}

export function ensureUploadDir(): void {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/** PB `uploads` record → the Track shape the whole app speaks. */
export function mapUpload(row: RecordModel): Track {
  return {
    id: `upload:${row.id}`,
    source: 'upload',
    sourceId: row.id,
    title: (row.title as string) ?? 'Untitled',
    artist: (row.artist as string) || 'Unknown artist',
    artistId: null,
    album: (row.album as string) || null,
    albumId: null,
    durationSec: (row.duration_sec as number) ?? 0,
    artworkUrl: null,
    streamUrl: `/api/uploads/${row.id}/stream`,
  };
}

// PB filter strings interpolate raw — escape user-controlled text.
function escape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Uploads matching a search query, newest first. Errors return [] — a
 *  problem here must not take down search for YouTube results. */
export async function searchUploads(pb: PocketBase, q: string, limit = 10): Promise<Track[]> {
  const term = escape(q.trim());
  if (!term) return [];
  try {
    const rows = await pb.collection('uploads').getList(1, limit, {
      filter: `title ~ "${term}" || artist ~ "${term}" || album ~ "${term}"`,
      sort: '-created',
    });
    return rows.items.map(mapUpload);
  } catch {
    return [];
  }
}
