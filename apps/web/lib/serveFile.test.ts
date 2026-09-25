/** Byte ranges for member uploads and prank sounds (lib/serveFile). The YouTube
 *  stream route got these right in bughunt P10; this shared copy did not
 *  (bughunt 2026-09-25 P6):
 *   - `bytes=-N` (the last N bytes) was served as the FIRST N+1 bytes;
 *   - an end past the file (`bytes=0-99999999`, which some players send) was
 *     refused with 416 instead of clamped to the file, as RFC 9110 asks. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveFile } from './serveFile';

let dir: string;
let file: string;
const BYTES = Buffer.from(Array.from({ length: 100 }, (_, i) => i));

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'servefile-'));
  file = path.join(dir, 'song.mp3');
  fs.writeFileSync(file, BYTES);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

async function body(r: Response): Promise<number[]> {
  return [...new Uint8Array(await r.arrayBuffer())];
}

describe('serveFile ranges', () => {
  it('serves the last N bytes for a suffix range', async () => {
    const r = serveFile(file, 'bytes=-10');
    expect(r.status).toBe(206);
    expect(r.headers.get('Content-Range')).toBe('bytes 90-99/100');
    expect(r.headers.get('Content-Length')).toBe('10');
    expect(await body(r)).toEqual([...BYTES.subarray(90)]);
  });

  it('a suffix longer than the file is the whole file', async () => {
    const r = serveFile(file, 'bytes=-500');
    expect(r.status).toBe(206);
    expect(r.headers.get('Content-Range')).toBe('bytes 0-99/100');
    expect((await body(r)).length).toBe(100);
  });

  it('clamps an end past the file instead of refusing it', async () => {
    const r = serveFile(file, 'bytes=50-99999');
    expect(r.status).toBe(206);
    expect(r.headers.get('Content-Range')).toBe('bytes 50-99/100');
    expect(r.headers.get('Content-Length')).toBe('50');
    expect((await body(r)).length).toBe(50);
  });

  it('still refuses a start past the end, and an empty suffix', () => {
    expect(serveFile(file, 'bytes=100-').status).toBe(416);
    expect(serveFile(file, 'bytes=-0').status).toBe(416);
  });

  it('ordinary ranges and no range are unchanged', async () => {
    const r = serveFile(file, 'bytes=0-9');
    expect(r.headers.get('Content-Range')).toBe('bytes 0-9/100');
    expect(await body(r)).toEqual([...BYTES.subarray(0, 10)]);
    const all = serveFile(file, null);
    expect(all.status).toBe(200);
    expect((await body(all)).length).toBe(100);
  });
});
