import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseCsv, readCsv } from '@/lib/import/sources/csv';
import { isParseError, MAX_FIELD_CHARS } from '@/lib/import/sources/types';
import { decodeText } from '@/lib/import/sources/index';

// tests/fixtures/imports/transfer: the layouts the exporters people use
// actually produce (invented songs), plus the awkward files: a byte-order
// mark with CR LF ends, quoted commas and doubled quotes, and one with no
// song column at all.
const FIXTURES = path.resolve(__dirname, '../../../../../tests/fixtures/imports/transfer');
const raw = (name: string) => readFileSync(path.join(FIXTURES, name));
const text = (name: string) => {
  const decoded = decodeText(new Uint8Array(raw(name)));
  if (typeof decoded !== 'string') throw new Error(decoded.error);
  return decoded;
};

function parse(name: string) {
  const r = parseCsv(text(name));
  if (isParseError(r)) throw new Error(r.error);
  return r;
}

describe('readCsv', () => {
  it('reads quoted fields, doubled quotes, and commas and newlines inside them', () => {
    const rows = readCsv('a,b\n"x, y","he said ""no"""\n"two\nlines",z\n', ',');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "no"'],
      ['two\nlines', 'z'],
    ]);
  });

  it('CR LF ends read the same as LF ones', () => {
    expect(readCsv('a,b\r\n1,2\r\n', ',')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('stops at the row cap rather than reading a file forever', () => {
    const many = 'a\n' + '1\n'.repeat(50);
    expect(readCsv(many, ',', 10)).toHaveLength(10);
  });
});

describe('parseCsv, the 2026 Exportify layout', () => {
  const r = () => parse('exportify.sample.csv');

  it('finds the song, artists, length and uri among 19 columns', () => {
    expect(r().items[0]).toMatchObject({
      position: 0,
      title: 'Paper Lanterns',
      artist: 'Halcyon Drift',
      artists: ['Halcyon Drift'],
      durationMs: 214000,
      uri: 'spotify:track:1AbCdEfGhIjKlMnOpQrStU',
    });
  });

  it('a quoted comma inside a song name stays part of the name', () => {
    expect(r().items[1].title).toBe('Slow Weather, Pt. 2');
  });

  it('splits an artist line on its commas, keeping the whole line beside it', () => {
    // No exporter says where one artist stops, so a band with a comma in its
    // name splits too. The full line is what saves the match.
    expect(r().items[2].artists).toEqual(['Earth', 'Wind & Fire', 'The Quiet Parade']);
    expect(r().items[2].artist).toBe('Earth, Wind & Fire, The Quiet Parade');
  });

  it('takes Added At as the real like date, so nothing has to be synthesised', () => {
    expect(r().items[0].likedAt).toBe(Date.parse('2023-05-02T10:14:32Z'));
    expect(r().items.every((i) => i.likedAt !== null)).toBe(true);
  });

  it('reads a file whose dates climb as oldest-first', () => {
    expect(r().order).toBe('oldest-first');
  });

  it('knows the songs came from Spotify by their uris', () => {
    expect(r().fromSpotify).toBe(true);
    expect(r().apple).toBe(false);
  });
});

describe('parseCsv, the other exporters', () => {
  it('reads the older Exportify layout', () => {
    const r = parse('exportify-old.sample.csv');
    expect(r.items.map((i) => i.title)).toEqual(['Paper Lanterns', 'Fjord, at Dawn']);
    expect(r.items[1].durationMs).toBe(305000);
  });

  it('reads a semicolon file with clock-style lengths (Soundiiz)', () => {
    const r = parse('soundiiz.sample.csv');
    expect(r.items.map((i) => i.title)).toEqual(['Paper Lanterns', 'Slow Weather', 'Cold Open']);
    expect(r.items[0].durationMs).toBe(214_000);
    // No date column at all: every song's place is worked out later.
    expect(r.order).toBe('unknown');
    expect(r.items.every((i) => i.likedAt === null)).toBe(true);
  });

  it('reads TuneMyMusic and drops the row with no song name', () => {
    const r = parse('tunemymusic.sample.csv');
    expect(r.items.map((i) => i.title)).toEqual(['Paper Lanterns', 'Nine Streets']);
    expect(r.dropped).toBe(1);
  });

  it('reads spotify-backup, whose date column is called Added', () => {
    const r = parse('spotify-backup.sample.csv');
    expect(r.items[0].likedAt).toBe(Date.parse('2021-01-01'));
    expect(r.order).toBe('oldest-first');
    expect(r.fromSpotify).toBe(false);
  });
});

describe("parseCsv, Apple's Likes and Dislikes", () => {
  const r = () => parse('apple-likes.sample.csv');

  it('splits "Artist - Title" out of the one description column', () => {
    expect(r().items[0]).toMatchObject({ artist: 'Halcyon Drift', title: 'Paper Lanterns' });
  });

  it('keeps what was loved and leaves the dislikes behind', () => {
    expect(r().items.map((i) => i.title)).toEqual(['Paper Lanterns', 'Slow Weather']);
    expect(r().dropped).toBe(1);
  });

  it('takes Last Modified as the like date and names itself apple-export', () => {
    expect(r().kind).toBe('apple-export');
    expect(r().apple).toBe(true);
    expect(r().items[0].likedAt).toBe(Date.parse('2024-05-01T12:00:00Z'));
  });
});

describe('parseCsv, the awkward files', () => {
  it('a byte-order mark and CR LF ends do not confuse the header', () => {
    const r = parse('bom-crlf.sample.csv');
    expect(r.items.map((i) => i.title)).toEqual(['Slow Weather, Pt. 2', 'She Said "No" Twice', 'Nine Streets']);
    expect(r.items[2].artist).toBe('Earth, Wind & Fire');
  });

  it('a file with no song column is refused, with its own header quoted back', () => {
    const r = parseCsv(text('no-title-column.sample.csv'));
    expect(isParseError(r)).toBe(true);
    expect((r as { error: string }).error).toContain('isrc,popularity,added by,duration (ms)');
  });

  it('an empty file says so', () => {
    expect(parseCsv('')).toHaveProperty('error');
  });

  it('a cell that runs on forever is cut, not refused', () => {
    const long = 'x'.repeat(MAX_FIELD_CHARS + 200);
    const r = parseCsv(`Track Name,Artist Name\n${long},A\n`);
    if (isParseError(r)) throw new Error(r.error);
    expect(r.items[0].title).toHaveLength(MAX_FIELD_CHARS);
  });

  it('blank lines between rows are skipped, not counted as dropped', () => {
    const r = parseCsv('Track Name,Artist Name\nA,B\n\n\nC,D\n');
    if (isParseError(r)) throw new Error(r.error);
    expect(r.items.map((i) => i.title)).toEqual(['A', 'C']);
    expect(r.dropped).toBe(0);
  });
});
