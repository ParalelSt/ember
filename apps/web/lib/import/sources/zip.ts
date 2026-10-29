/** Just enough of the zip format to take one file out of a Spotify export.
 *
 *  Spotify mails "my_spotify_data.zip", and people upload it as it is
 *  rather than unzipping it first (autofix 2026-10-18: a 422, retries, then
 *  an hour of 429s). So the zip is opened here: the central directory names
 *  every file, the one wanted is found by name and inflated with zlib. No
 *  dependency, no disk. Stored (0) and deflated (8) entries only, which is
 *  what every zip tool writes; anything else reads as "not found". */

import { inflateRawSync } from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

/** Every file the zip's central directory lists, or null when the bytes
 *  are not a zip Ember can read. */
export function listZip(bytes: Uint8Array): ZipEntry[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end record sits in the last 22 bytes plus a comment of up to 64 KB.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== CENTRAL_SIG) return null;
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    entries.push({
      method: view.getUint16(p + 10, true),
      compressedSize: view.getUint32(p + 20, true),
      size: view.getUint32(p + 24, true),
      localOffset: view.getUint32(p + 42, true),
      name: new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen)),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** The bytes of one entry, or null when it cannot be read or would come
 *  out bigger than `maxBytes` (a zip bomb stops at the cap, it is never
 *  inflated in full). */
export function readZipEntry(bytes: Uint8Array, entry: ZipEntry, maxBytes: number): Uint8Array | null {
  if (entry.size > maxBytes) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const p = entry.localOffset;
  if (p + 30 > bytes.length || view.getUint32(p, true) !== LOCAL_SIG) return null;
  const start = p + 30 + view.getUint16(p + 26, true) + view.getUint16(p + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (data.length !== entry.compressedSize) return null;
  if (entry.method === 0) return data;
  if (entry.method !== 8) return null;
  try {
    return new Uint8Array(inflateRawSync(data, { maxOutputLength: maxBytes }));
  } catch {
    return null;
  }
}
