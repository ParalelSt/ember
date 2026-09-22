import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  decodeText,
  isParseError,
  MAX_TRANSFER_ITEMS,
  MAX_UPLOAD_BYTES,
  parseTransferInput,
  tooLarge,
  TOO_LARGE_MESSAGE,
  UTF16_MESSAGE,
  ZIP_MESSAGE,
} from '@/lib/import/sources/index';

const FIXTURES = path.resolve(__dirname, '../../../../../tests/fixtures/imports/transfer');
const bytes = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));
const text = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8');

function parse(input: Parameters<typeof parseTransferInput>[0]) {
  const r = parseTransferInput(input);
  if (isParseError(r)) throw new Error(r.error);
  return r;
}

describe('decodeText', () => {
  it('strips a byte-order mark and reads the rest as UTF-8', () => {
    const decoded = decodeText(bytes('bom-crlf.sample.csv'));
    expect(typeof decoded).toBe('string');
    expect(decoded as string).toMatch(/^Track Name/);
  });

  it('turns a UTF-16 file away rather than reading it as gibberish', () => {
    expect(decodeText(bytes('utf16.sample.csv'))).toEqual({ error: UTF16_MESSAGE });
  });

  it('turns a zip away with the one thing the person can do about it', () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
    expect(decodeText(zip)).toEqual({ error: ZIP_MESSAGE });
  });

  it('refuses bytes that are not text at all', () => {
    expect(decodeText(new Uint8Array([0xc3, 0x28, 0xa0, 0xa1]))).toMatchObject({ error: expect.stringContaining('UTF-8') });
  });

  it('refuses anything over the size cap before it reads a byte of it', () => {
    expect(tooLarge(MAX_UPLOAD_BYTES)).toBe(false);
    expect(tooLarge(MAX_UPLOAD_BYTES + 1)).toBe(true);
    expect(decodeText(new Uint8Array(MAX_UPLOAD_BYTES + 1))).toEqual({ error: TOO_LARGE_MESSAGE });
  });
});

describe('parseTransferInput sniffs what arrived', () => {
  it('JSON goes to the Spotify export reader', () => {
    const r = parse({ filename: 'YourLibrary.json', bytes: bytes('YourLibrary.sample.json') });
    expect(r.kind).toBe('spotify-export');
    expect(r.label).toBe('Liked songs from Spotify');
  });

  it('a header row goes to the CSV sniffer, and Spotify uris name the source', () => {
    const r = parse({ filename: 'exportify.csv', bytes: bytes('exportify.sample.csv') });
    expect(r.kind).toBe('csv');
    expect(r.label).toBe('Liked songs from Spotify');
    expect(r.order).toBe('oldest-first');
  });

  it("a CSV with no Spotify uris is just a file", () => {
    expect(parse({ text: text('soundiiz.sample.csv') }).label).toBe('Liked songs from a file');
  });

  it("Apple's export names itself", () => {
    const r = parse({ filename: 'Apple Music Likes and Dislikes.csv', bytes: bytes('apple-likes.sample.csv') });
    expect(r.kind).toBe('apple-export');
    expect(r.label).toBe('Liked songs from Apple Music');
  });

  it('a pasted list is read as lines, even when a song name has a comma in it', () => {
    const r = parse({ text: 'Earth, Wind & Fire - September\nHalcyon Drift - Paper Lanterns' });
    expect(r.kind).toBe('paste');
    expect(r.items.map((i) => i.artist)).toEqual(['Earth, Wind & Fire', 'Halcyon Drift']);
  });

  it('a .csv with no song column is refused by name, not read as a paste', () => {
    const r = parseTransferInput({ filename: 'export.csv', bytes: bytes('no-title-column.sample.csv') });
    expect(isParseError(r)).toBe(true);
    expect((r as { error: string }).error).toContain('could not find a song column');
  });

  it('broken JSON says it is broken rather than being read line by line', () => {
    const r = parseTransferInput({ text: '{ "tracks": [ ' });
    expect((r as { error: string }).error).toContain('YourLibrary.json');
  });

  it('nothing at all says so', () => {
    expect(parseTransferInput({})).toHaveProperty('error');
    expect(parseTransferInput({ text: '   \n ' })).toHaveProperty('error');
  });

  it('a pasted list over the size cap is refused too', () => {
    expect(parseTransferInput({ text: 'x'.repeat(MAX_UPLOAD_BYTES + 1) })).toEqual({ error: TOO_LARGE_MESSAGE });
  });
});

describe('parseTransferInput cleans up what it read', () => {
  it('drops repeats, counting them alongside the rows it could not read', () => {
    const r = parse({ filename: 'YourLibrary.json', bytes: bytes('YourLibrary.sample.json') });
    // Six rows in the file: one with no name, one a repeat of the first.
    expect(r.items.map((i) => i.title)).toEqual(['Paper Lanterns', 'Slow Weather', 'Nine Streets', 'Fjord, at Dawn']);
    expect(r.dropped).toBe(2);
    expect(r.items.map((i) => i.position)).toEqual([0, 1, 2, 3]);
  });

  it('a repeat in a pasted list goes too', () => {
    const r = parse({ text: readFileSync(path.join(FIXTURES, 'paste.sample.txt'), 'utf8') });
    expect(r.items.filter((i) => i.title === 'Paper Lanterns')).toHaveLength(1);
    expect(r.dropped).toBe(1);
  });

  it('more songs than one transfer may carry are cut, and the flag says so', () => {
    const many = Array.from({ length: MAX_TRANSFER_ITEMS + 1 }, (_, i) => `Artist ${i} - Song ${i}`).join('\n');
    const r = parse({ text: many });
    expect(r.items).toHaveLength(MAX_TRANSFER_ITEMS);
    expect(r.truncated).toBe(true);
  });

  it('a list that fits is not flagged', () => {
    expect(parse({ text: 'A - B\nC - D' }).truncated).toBe(false);
  });
});
