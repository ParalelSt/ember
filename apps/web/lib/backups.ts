import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline, Readable } from 'node:stream';
import zlib from 'node:zlib';
import type PocketBase from 'pocketbase';
import { serverLogger } from '@/lib/logger/server';

/** Database backups (PocketBase's built-in backups) plus the member files
 *  that live outside pb_data. See SETUP.md, "Backups".
 *
 *  PocketBase does the database side: pocketbase/pb_hooks/ensure_backups.pb.js
 *  turns on a nightly schedule, each backup is a zip of pb_data (database and
 *  pb_data/storage, which holds avatars and playlist artwork) in
 *  pb_data/backups. Everything here goes through PocketBase's backups API
 *  with the superuser client, so the Next server never reads pb_data itself
 *  except to ask the OS how much room is left on that disk.
 *
 *  Member files are NOT in pb_data: uploaded songs and their covers, tabs and
 *  prank sounds sit under MUSIC_DIR. They are streamed on demand as one
 *  .tar.gz (memberFilesArchive). The cached YouTube audio in MUSIC_DIR itself
 *  is left out on purpose: it downloads again on the next play. */

// apps/web is two directories deep in the workspace.
const ROOT = path.resolve(process.cwd(), '..', '..');

export function pbDataDir(): string {
  return process.env.EMBER_PB_DATA_DIR || path.join(ROOT, 'pocketbase', 'pb_data');
}

export function musicDir(): string {
  return process.env.MUSIC_DIR ?? path.join(ROOT, 'my_music');
}

/** The MUSIC_DIR subfolders that hold things nobody can download again. */
export const MEMBER_FILE_DIRS = ['uploads', 'tabs', 'pranks'] as const;

// ── backup names ─────────────────────────────────────────────────────────

/** PocketBase's own names: "pb_backup_<app>_<stamp>.zip" for manual ones,
 *  "@auto_pb_backup_<app>_<stamp>.zip" for scheduled ones. Anything that is
 *  not a plain file name ending in .zip is refused before PocketBase sees
 *  it: no slashes, no backslashes, no "..", no percent escapes. */
const BACKUP_NAME_RE = /^@?[A-Za-z0-9_-][A-Za-z0-9_.-]{0,150}\.zip$/;

export function isValidBackupName(name: string): boolean {
  return BACKUP_NAME_RE.test(name) && !name.includes('..');
}

// ── listing and creating ─────────────────────────────────────────────────

export interface BackupInfo {
  name: string;
  size: number;
  /** ISO timestamp. */
  modified: string;
  /** Made by the schedule (PocketBase prunes these) rather than by hand. */
  auto: boolean;
}

/** PocketBase dates look like "2026-09-26 08:34:00.018Z". */
function isoDate(pbDate: string): string {
  const d = new Date(pbDate.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? pbDate : d.toISOString();
}

export async function listBackups(pb: PocketBase): Promise<BackupInfo[]> {
  const items = await pb.backups.getFullList();
  return items
    .map((b) => ({
      name: b.key,
      size: b.size,
      modified: isoDate(b.modified),
      auto: b.key.startsWith('@auto'),
    }))
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

/** Makes a backup now and waits for it (PocketBase answers once the zip is
 *  written). PocketBase names it. */
export async function createBackup(pb: PocketBase): Promise<void> {
  await pb.backups.create('');
}

/** PocketBase 0.22 answers 400 both for "another backup or restore is
 *  running" and for a backup that failed; only the first is a 409. */
export function isBackupBusy(e: unknown): boolean {
  const err = e as { status?: number; message?: string; response?: { message?: string } };
  if (err?.status !== 400) return false;
  return /already been started|try again later/i.test(`${err.response?.message ?? ''} ${err.message ?? ''}`);
}

export interface BackupSchedule {
  /** Empty when automatic backups are off. */
  cron: string;
  keep: number;
  /** Stored on S3 instead of pb_data/backups. */
  s3: boolean;
}

export async function readSchedule(pb: PocketBase): Promise<BackupSchedule | null> {
  try {
    const s = (await pb.settings.getAll()) as {
      backups?: { cron?: string; cronMaxKeep?: number; s3?: { enabled?: boolean } };
    };
    return {
      cron: s.backups?.cron ?? '',
      keep: s.backups?.cronMaxKeep ?? 0,
      s3: !!s.backups?.s3?.enabled,
    };
  } catch {
    return null;
  }
}

/** Streams one backup out of PocketBase. The caller validates the name and
 *  checks it is in the list first. */
export async function fetchBackup(pb: PocketBase, name: string): Promise<Response> {
  const token = await pb.files.getToken();
  return fetch(pb.backups.getDownloadURL(token, name), { cache: 'no-store' });
}

// ── disk space ───────────────────────────────────────────────────────────

export interface DiskInfo {
  free: number;
  total: number;
  /** Too little room for the next few backups. */
  low: boolean;
}

/** Warn below this much free space, or below three of the largest backup,
 *  whichever is more: a backup needs room for its zip while it is written,
 *  and the schedule keeps several. */
export const LOW_DISK_MIN_BYTES = 2 * 1024 * 1024 * 1024;

export function isLowDisk(free: number, largestBackup: number): boolean {
  return free < Math.max(LOW_DISK_MIN_BYTES, 3 * largestBackup);
}

/** Free space on the disk that holds pb_data (the workspace root when
 *  pb_data is not where this server expects it). Null when the OS will not
 *  say. */
export async function diskInfo(largestBackup: number): Promise<DiskInfo | null> {
  const dir = fs.existsSync(pbDataDir()) ? pbDataDir() : ROOT;
  try {
    const s = await fs.promises.statfs(dir);
    const free = s.bavail * s.bsize;
    return { free, total: s.blocks * s.bsize, low: isLowDisk(free, largestBackup) };
  } catch {
    return null;
  }
}

// ── member files ─────────────────────────────────────────────────────────

interface FileEntry {
  /** Path inside the archive, forward slashes. */
  name: string;
  full: string;
  size: number;
  mtime: number;
}

/** Every regular file under the member-file folders. Symlinks are skipped,
 *  so nothing outside MUSIC_DIR can be pulled in. */
export async function memberFiles(root: string = musicDir()): Promise<FileEntry[]> {
  const out: FileEntry[] = [];
  const walk = async (dir: string, rel: string) => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const name = `${rel}/${e.name}`;
      if (e.isDirectory()) await walk(full, name);
      else if (e.isFile()) {
        try {
          const st = await fs.promises.stat(full);
          out.push({ name, full, size: st.size, mtime: st.mtimeMs });
        } catch {
          // Deleted while walking: leave it out.
        }
      }
    }
  };
  for (const sub of MEMBER_FILE_DIRS) await walk(path.join(root, sub), sub);
  return out;
}

export async function memberFilesSummary(root?: string): Promise<{ files: number; bytes: number }> {
  const files = await memberFiles(root);
  return { files: files.length, bytes: files.reduce((n, f) => n + f.size, 0) };
}

// A minimal ustar writer: no dependency, and it streams, so a large uploads
// folder never sits in memory. Every file is a header block, its bytes, and
// zero padding to 512; two zero blocks end the archive.

const BLOCK = 512;
const MAX_TAR_SIZE = 0o77777777777; // 11 octal digits, about 8 GiB

function octal(n: number, width: number): string {
  return Math.floor(n).toString(8).padStart(width - 1, '0') + '\0';
}

/** Splits a long path into ustar's prefix (155) and name (100) fields at a
 *  slash. Null when it cannot fit. */
function splitName(name: string): { prefix: string; name: string } | null {
  if (Buffer.byteLength(name) <= 100) return { prefix: '', name };
  for (let i = name.lastIndexOf('/'); i > 0; i = name.lastIndexOf('/', i - 1)) {
    const prefix = name.slice(0, i);
    const rest = name.slice(i + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(rest) <= 100) return { prefix, name: rest };
  }
  return null;
}

export function tarHeader(name: string, size: number, mtimeMs: number): Buffer | null {
  const parts = splitName(name);
  if (!parts || size > MAX_TAR_SIZE) return null;
  const h = Buffer.alloc(BLOCK, 0);
  h.write(parts.name, 0, 100, 'utf8');
  h.write('0000644\0', 100, 8, 'ascii');
  h.write('0000000\0', 108, 8, 'ascii');
  h.write('0000000\0', 116, 8, 'ascii');
  h.write(octal(size, 12), 124, 12, 'ascii');
  h.write(octal(mtimeMs / 1000, 12), 136, 12, 'ascii');
  h.write('        ', 148, 8, 'ascii'); // checksum counts as spaces
  h.write('0', 156, 1, 'ascii');
  h.write('ustar\0', 257, 6, 'ascii');
  h.write('00', 263, 2, 'ascii');
  h.write(parts.prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(octal(sum, 7) + ' ', 148, 8, 'ascii');
  return h;
}

const READ_CHUNK = 256 * 1024;

async function* tarEntries(files: FileEntry[], top: string): AsyncGenerator<Buffer> {
  for (const f of files) {
    const header = tarHeader(`${top}/${f.name}`, f.size, f.mtime);
    if (!header) {
      serverLogger.warn('backups', `member files: left out ${f.name}, its name or size does not fit a tar`, { file: f.name });
      continue;
    }
    // Opened before its header is written, so a file that cannot be read is
    // left out (and logged) instead of turning up as a zero-filled copy.
    let handle: fs.promises.FileHandle;
    try {
      handle = await fs.promises.open(f.full, 'r');
    } catch (err) {
      serverLogger.warn('backups', `member files: left out ${f.name}, it cannot be opened`, { file: f.name }, err);
      continue;
    }
    try {
      yield header;
      // Exactly the size in the header, even if the file changed since: a
      // longer file is cut, a shorter one padded with zeros (and logged), so
      // the rest of the archive stays readable.
      let written = 0;
      try {
        while (written < f.size) {
          const buf = Buffer.allocUnsafe(Math.min(READ_CHUNK, f.size - written));
          const { bytesRead } = await handle.read(buf, 0, buf.length, written);
          if (bytesRead === 0) break;
          yield buf.subarray(0, bytesRead);
          written += bytesRead;
        }
      } catch (err) {
        serverLogger.warn('backups', `member files: reading ${f.name} failed part way`, { file: f.name, written }, err);
      }
      if (written < f.size) {
        serverLogger.warn('backups', `member files: ${f.name} is incomplete in the archive (padded with zeros)`, {
          file: f.name,
          written,
          size: f.size,
        });
        yield Buffer.alloc(f.size - written, 0);
      }
      const pad = (BLOCK - (f.size % BLOCK)) % BLOCK;
      if (pad) yield Buffer.alloc(pad, 0);
    } finally {
      // Also runs when the download is cancelled half way.
      await handle.close().catch(() => {});
    }
  }
  yield Buffer.alloc(BLOCK * 2, 0);
}

/** The member files as a gzipped tar stream, every path under `top/`. */
export async function memberFilesArchive(root?: string, top = 'ember-files'): Promise<ReadableStream<Uint8Array>> {
  const files = await memberFiles(root);
  // pipeline, not pipe: a download cancelled half way tears down the reader
  // too, so no file handle is left open.
  const gz = pipeline(Readable.from(tarEntries(files, top)), zlib.createGzip(), (err) => {
    // A cancelled download is not a fault; anything else is worth a look.
    if (err && (err as NodeJS.ErrnoException).code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      serverLogger.warn('backups', 'member files archive stopped with an error', undefined, err);
    }
  });
  return Readable.toWeb(gz) as ReadableStream<Uint8Array>;
}

/** "ember-files-2026-09-26.tar.gz" */
export function memberFilesArchiveName(now: Date = new Date()): string {
  return `ember-files-${now.toISOString().slice(0, 10)}.tar.gz`;
}
