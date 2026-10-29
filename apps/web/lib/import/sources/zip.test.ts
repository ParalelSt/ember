// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { listZip, readZipEntry } from '@/lib/import/sources/zip';
import { makeZip } from '@/lib/import/sources/testZip';

const text = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null);

describe('listZip', () => {
  it('names every file in the zip', () => {
    const zip = makeZip([
      { name: 'Spotify Account Data/Userdata.json', data: '{}' },
      { name: 'Spotify Account Data/YourLibrary.json', data: '{"tracks":[]}' },
    ]);
    expect(listZip(zip)?.map((e) => e.name)).toEqual([
      'Spotify Account Data/Userdata.json',
      'Spotify Account Data/YourLibrary.json',
    ]);
  });

  it('is null for bytes that only start like a zip', () => {
    expect(listZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]))).toBeNull();
  });
});

describe('readZipEntry', () => {
  it('reads a deflated file and a stored one', () => {
    const zip = makeZip([
      { name: 'a.json', data: '{"a":1}'.repeat(50) },
      { name: 'b.txt', data: 'plain', stored: true },
    ]);
    const [a, b] = listZip(zip)!;
    expect(text(readZipEntry(zip, a!, 1_000_000))).toBe('{"a":1}'.repeat(50));
    expect(text(readZipEntry(zip, b!, 1_000_000))).toBe('plain');
  });

  it('stops at the cap instead of inflating a zip bomb', () => {
    const zip = makeZip([{ name: 'big.json', data: 'x'.repeat(200_000) }]);
    const [entry] = listZip(zip)!;
    expect(readZipEntry(zip, entry!, 100_000)).toBeNull();
    // A lying size field does not get past the cap either.
    expect(readZipEntry(zip, { ...entry!, size: 10 }, 100_000)).toBeNull();
  });
});
