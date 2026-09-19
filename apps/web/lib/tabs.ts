import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { newFilename } from '@/lib/uploads';

/** Guitar Pro tab files.
 *
 *  Songsterr can tell us WHICH song a tab is for, but never the notes — their
 *  player refuses to be embedded and the notation is their licensed content.
 *  So the notes come from a Guitar Pro file the member supplies, stored here
 *  and rendered by AlphaTab in the browser.
 *
 *  Files sit on disk beside the uploads (MUSIC_DIR/tabs), same reasoning:
 *  one backup story, and PB's database stays small. */

const ROOT = path.resolve(process.cwd(), '..', '..');
const MUSIC_DIR = process.env.MUSIC_DIR ?? path.join(ROOT, 'my_music');
export const TAB_DIR = path.join(MUSIC_DIR, 'tabs');

/** Tabs are small — a big Guitar Pro file is a couple of hundred KB. */
export const MAX_TAB_BYTES = Number(process.env.MAX_TAB_MB ?? 5) * 1024 * 1024;

export const TAB_EXTS = ['.gp3', '.gp4', '.gp5', '.gpx', '.gp', '.musicxml', '.mxl'] as const;

/** Magic-byte sniff, same reasoning as sniffAudio: the browser's
 *  Content-Type is a claim, and this file is streamed back later.
 *
 *  - gp3/gp4/gp5 open with a Pascal string: a length byte then
 *    "FICHIER GUITAR PRO v<n>".
 *  - gpx (Guitar Pro 6) is a BCFZ/BCFS container.
 *  - gp (Guitar Pro 7+) is a zip holding Content/score.gpif — the entry names
 *    sit in plaintext in the local headers even though the data is deflated,
 *    so a zip that never mentions score.gpif is some other zip, not a tab.
 *  - MusicXML is the open interchange format every notation editor exports:
 *    plain XML with a <score-partwise>/<score-timewise> root, or zipped as
 *    .mxl with a META-INF/container.xml. AlphaTab reads it directly. */
export function sniffTab(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  const ascii = (start: number, len: number) => buf.subarray(start, start + len).toString('ascii');

  if (ascii(1, 17) === 'FICHIER GUITAR PR') {
    const version = ascii(1, 24);
    if (version.includes('v3.')) return '.gp3';
    if (version.includes('v4.')) return '.gp4';
    return '.gp5';
  }
  if (ascii(0, 4) === 'BCFZ' || ascii(0, 4) === 'BCFS') return '.gpx';
  const head = buf.subarray(0, Math.min(buf.length, 8 * 1024)).toString('latin1');
  if (/<score-(partwise|timewise)/.test(head)) return '.musicxml';

  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    // Only look at the head — enough to cover the entry names, and it keeps a
    // large file from being scanned end to end.
    const zipHead = buf.subarray(0, Math.min(buf.length, 64 * 1024)).toString('latin1');
    if (zipHead.includes('score.gpif')) return '.gp';
    if (zipHead.includes('META-INF/container.xml')) return '.mxl';
  }
  return null;
}

export function newTabFilename(ext: string): string {
  return newFilename(ext);
}

/** Absolute path for a stored filename, refusing anything that escapes
 *  TAB_DIR. Deliberately a copy of the uploads guard rather than a shared
 *  helper taking a directory — a traversal check that can be pointed at the
 *  wrong directory is a footgun. */
export function resolveTabPath(filename: string): string | null {
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) return null;
  const full = path.join(TAB_DIR, filename);
  if (path.dirname(path.resolve(full)) !== path.resolve(TAB_DIR)) return null;
  return full;
}

export function ensureTabDir(): void {
  fs.mkdirSync(TAB_DIR, { recursive: true });
}

/** Where a generated tab's alphaTex lives: MUSIC_DIR/tabs/generated. */
export const GENERATED_DIR = path.join(TAB_DIR, 'generated');

/** The file behind a tab row: a file someone added sits in TAB_DIR, a
 *  generated one in GENERATED_DIR. Same traversal guard for both. */
export function resolveRowPath(row: { [key: string]: unknown }): string | null {
  const filename = String(row.file ?? '');
  if (row.kind !== 'generated') return resolveTabPath(filename);
  if (!/^[A-Za-z0-9_-]+\.alphatex$/.test(filename)) return null;
  return path.join(GENERATED_DIR, filename);
}

/** A pasted text tab is two files side by side in TAB_DIR: `<stem>.alphatex`
 *  (the row's file, what AlphaTab loads) and `<stem>.txt` (the text as it
 *  was pasted, kept so a better parser can redo the alphaTex later). */
export function pastedTextPath(row: { [key: string]: unknown }): string | null {
  if (row.kind !== 'pasted') return null;
  const filename = String(row.file ?? '');
  if (!filename.endsWith('.alphatex')) return null;
  return resolveTabPath(`${filename.slice(0, -'.alphatex'.length)}.txt`);
}

/** Every file on disk behind a row: what delete removes. */
export function rowPaths(row: { [key: string]: unknown }): string[] {
  return [resolveRowPath(row), pastedTextPath(row)].filter((p): p is string => !!p);
}
