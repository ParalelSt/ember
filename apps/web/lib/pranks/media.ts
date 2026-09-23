import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import type { RecordModel } from 'pocketbase';
import { ALLOWED_TYPES, sniffAudio } from '@/lib/uploads';
import { PRANK_LIMITS } from './limits';
import type { PrankSound, PrankSoundKind } from './types';

/** The admin prank library on disk: MUSIC_DIR/pranks, beside (never inside)
 *  the member uploads, so nothing that lists or serves uploads can reach it.
 *  Read at call time so tests can point MUSIC_DIR somewhere else. */
export function prankDir(): string {
  const root = path.resolve(process.cwd(), '..', '..');
  return path.join(process.env.MUSIC_DIR ?? path.join(root, 'my_music'), 'pranks');
}

/** Resolves a stored filename inside the prank directory, refusing anything
 *  that could escape it (the same rules as resolveUploadPath). */
export function resolvePrankPath(filename: string): string | null {
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) return null;
  const dir = prankDir();
  const full = path.join(dir, filename);
  if (path.dirname(path.resolve(full)) !== path.resolve(dir)) return null;
  return full;
}

export function ensurePrankDir(): void {
  fs.mkdirSync(prankDir(), { recursive: true });
}

const MB = 1024 * 1024;

/** Upload caps per kind (owner decisions, 2026-09-23). */
export const PRANK_UPLOAD_CAPS: Record<PrankSoundKind, { maxBytes: number; maxSec: number | null }> = {
  sound: { maxBytes: 5 * MB, maxSec: PRANK_LIMITS.soundMaxSec },
  song: { maxBytes: 50 * MB, maxSec: null },
};

export const PRANK_SOUND_KINDS: readonly PrankSoundKind[] = ['sound', 'song'];

/** Where the receiver loads a library file from. Relative on purpose: the
 *  receiver refuses anything else. */
export const prankMediaUrl = (id: string) => `/api/pranks/media/${id}`;

export type UploadCheck = { ok: true; ext: string } | { ok: false; status: number; error: string };

/** Everything about an upload that can be decided before it touches the
 *  disk, except its length (see checkPrankDuration). The bytes decide the
 *  format; a claimed type only has to be one we accept. */
export function checkPrankUpload(kind: PrankSoundKind, size: number, head: Buffer, claimedType: string): UploadCheck {
  const cap = PRANK_UPLOAD_CAPS[kind];
  if (size === 0) return { ok: false, status: 400, error: 'That file is empty' };
  if (size > cap.maxBytes) {
    const what = kind === 'sound' ? 'Sounds' : 'Prank songs';
    return { ok: false, status: 413, error: `${what} are ${cap.maxBytes / MB} MB at most` };
  }
  const ext = sniffAudio(head);
  if (!ext) return { ok: false, status: 415, error: 'That does not look like an audio file' };
  const claimed = claimedType.toLowerCase();
  if (claimed && !ALLOWED_TYPES[claimed]) return { ok: false, status: 415, error: `Unsupported audio type: ${claimedType}` };
  return { ok: true, ext };
}

/** The length rule. A sound must have a measurable length of 30 s or less;
 *  a song only needs one for display, so an unreadable length is fine. */
export function checkPrankDuration(kind: PrankSoundKind, durationSec: number | null): UploadCheck | null {
  const max = PRANK_UPLOAD_CAPS[kind].maxSec;
  if (max === null) return null;
  if (durationSec === null) return { ok: false, status: 415, error: 'Could not tell how long that sound is; try an mp3 or m4a' };
  if (durationSec > max + 0.5) {
    return { ok: false, status: 400, error: `Sounds are ${max} seconds at most; upload it as a song` };
  }
  return null;
}

/** The file's length in seconds, or null when the parser cannot tell. */
export async function measureDuration(buf: Buffer, mimeType: string): Promise<number | null> {
  try {
    const { parseBuffer } = await import('music-metadata');
    const meta = await parseBuffer(buf, { mimeType: mimeType || undefined, size: buf.length }, { duration: true });
    const d = meta.format.duration;
    return typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : null;
  } catch {
    return null;
  }
}

/** A library record as the admin page sees it. */
export function toPrankSound(row: RecordModel): PrankSound {
  return {
    id: row.id,
    kind: row.kind === 'song' ? 'song' : 'sound',
    name: String(row.name ?? ''),
    durationSec: typeof row.duration_sec === 'number' ? row.duration_sec : 0,
    sizeBytes: typeof row.size_bytes === 'number' ? row.size_bytes : 0,
    mime: String(row.mime ?? ''),
    created: String(row.created ?? ''),
    url: prankMediaUrl(row.id),
  };
}
