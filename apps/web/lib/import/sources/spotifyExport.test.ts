import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseSpotifyExport } from '@/lib/import/sources/spotifyExport';
import { isParseError } from '@/lib/import/sources/types';

const FIXTURES = path.resolve(__dirname, '../../../../../tests/fixtures/imports/transfer');
const library = () => JSON.parse(readFileSync(path.join(FIXTURES, 'YourLibrary.sample.json'), 'utf8')) as unknown;

function parsed() {
  const r = parseSpotifyExport(library());
  if (isParseError(r)) throw new Error(r.error);
  return r;
}

describe('parseSpotifyExport', () => {
  it('reads the tracks and ignores every other key of the export', () => {
    const r = parsed();
    expect(r.kind).toBe('spotify-export');
    expect(r.label).toBe('Liked songs from Spotify');
    expect(r.order).toBe('unknown');
    expect(r.items.map((i) => i.title)).toEqual([
      'Paper Lanterns',
      'Slow Weather',
      'Paper Lanterns',
      'Nine Streets',
      'Fjord, at Dawn',
    ]);
  });

  it('keeps the artist as both the line and the one-name list', () => {
    expect(parsed().items[0]).toMatchObject({ artist: 'Halcyon Drift', artists: ['Halcyon Drift'] });
  });

  it('keeps a real track uri and drops one that is not', () => {
    const items = parsed().items;
    expect(items[0].uri).toBe('spotify:track:1AbCdEfGhIjKlMnOpQrStU');
    expect(items[3].uri).toBeNull();
  });

  it('a row with no song name is dropped and counted', () => {
    expect(parsed().dropped).toBe(1);
  });

  it('says nothing about a like date: the export carries none', () => {
    expect(parsed().items.every((i) => i.likedAt === null)).toBe(true);
  });

  it('positions run from zero, in file order', () => {
    expect(parsed().items.map((i) => i.position)).toEqual([0, 1, 2, 3, 4]);
  });

  it('a file that is not the library says so', () => {
    expect(parseSpotifyExport({ albums: [] })).toMatchObject({ error: expect.stringContaining('YourLibrary.json') });
    expect(parseSpotifyExport(null)).toHaveProperty('error');
    expect(parseSpotifyExport({ tracks: [] })).toMatchObject({ error: expect.stringContaining('no liked songs') });
  });
});
