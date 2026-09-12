import 'server-only';
import fs from 'node:fs/promises';
import { UPLOAD_DIR, resolveUploadPath } from '@/lib/uploads';
import { serverLogger } from '@/lib/logger/server';

/** Embedded cover art for member uploads.
 *
 *  Songs people add from their own files usually already carry a cover in the
 *  tag (ID3 APIC, MP4 covr, FLAC PICTURE). Pulling it out once at upload time
 *  means every artwork surface in the app (the row, the player bar, Now
 *  Playing, the lock screen, and the offline downloader on Android) gets a
 *  real image for the library this app is actually built around, with no
 *  extra request at play time.
 *
 *  Parsing is best effort by design: a cover is a nicety, and a tag this
 *  parser dislikes must never cost someone their upload. */

/** Covers are shown at a few hundred pixels at most, so anything past a few
 *  megabytes is a scan of an LP sleeve nobody asked us to store. Skip it
 *  rather than spend the disk. */
export const MAX_COVER_BYTES = 5 * 1024 * 1024;

/** The two formats we keep. Tags can hold GIF, BMP or WebP as well, but those
 *  are rare enough that supporting them would be untested code. */
export const COVER_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
};

/** Cover extension for a picture's reported format, or null if we don't keep
 *  that format. music-metadata reports a MIME type, but tags in the wild also
 *  carry bare "JPG"/"PNG", so match loosely. */
export function coverExtFor(format: string | undefined): 'jpg' | 'png' | null {
  const f = (format ?? '').toLowerCase();
  if (f.includes('jpeg') || f.includes('jpg')) return 'jpg';
  if (f.includes('png')) return 'png';
  return null;
}

/** The cover file's name on disk. It is keyed by the upload's record id, not
 *  by the audio filename, so the art route can find it from the id in the URL
 *  without reading the record's filename field. */
export function coverFilename(id: string, ext: string): string {
  return `${id}.${ext}`;
}

export interface ExtractedCover {
  ext: 'jpg' | 'png';
  data: Buffer;
}

/** First embedded picture in `audio`, or null when there is none, it is a
 *  format we don't keep, it is over the size cap, or the file won't parse.
 *
 *  No content type is passed in on purpose. The browser's Content-Type is a
 *  claim the upload route already declines to trust, and handing music-metadata
 *  a wrong one makes it pick the wrong parser and quietly report no pictures.
 *  Given no hint it sniffs the bytes, which is the same thing sniffAudio does. */
export async function extractCover(audio: Buffer): Promise<ExtractedCover | null> {
  try {
    // Imported lazily: the parser is a megabyte of format readers that only
    // an actual upload needs, and nothing else in the server bundle wants it.
    const { parseBuffer } = await import('music-metadata');
    // Duration comes from the browser (see the upload route), so skip the
    // full-file scan that computing it here would cost.
    const metadata = await parseBuffer(audio, undefined, { duration: false });
    const picture = metadata.common.picture?.[0];
    if (!picture) return null;

    const ext = coverExtFor(picture.format);
    if (!ext) return null;

    const data = Buffer.from(picture.data);
    if (data.length === 0 || data.length > MAX_COVER_BYTES) return null;
    return { ext, data };
  } catch {
    return null;
  }
}

/** Extracts the cover and writes it next to the audio as `<id>.<ext>`.
 *  Returns the extension to record on the upload, or null if there was no
 *  usable cover. Never throws: the upload has already succeeded by the time
 *  this runs, and a missing cover is not a failed upload. */
export async function saveUploadCover(audio: Buffer, id: string): Promise<string | null> {
  try {
    const cover = await extractCover(audio);
    if (!cover) return null;
    // The id comes from PocketBase and is alphanumeric, but resolve it the
    // same defensive way the audio path is resolved rather than trusting that.
    const full = resolveUploadPath(coverFilename(id, cover.ext));
    if (!full) return null;
    await fs.writeFile(full, cover.data);
    return cover.ext;
  } catch (e) {
    serverLogger.error('api', 'upload cover extraction failed', { id, dir: UPLOAD_DIR }, e);
    return null;
  }
}

/** Removes an upload's cover file, if it has one. Best effort: a leftover
 *  image is harmless next to a deleted song. */
export async function deleteUploadCover(id: string, ext: string): Promise<void> {
  if (!COVER_MIME[ext]) return;
  const full = resolveUploadPath(coverFilename(id, ext));
  if (!full) return;
  await fs.unlink(full).catch(() => {});
}
