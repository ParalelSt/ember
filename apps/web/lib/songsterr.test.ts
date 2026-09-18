// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSongsterrCache,
  parseSongs,
  readHints,
  searchSongsterr,
  toHints,
  toMatches,
} from './songsterr';

const RAW = [
  {
    songId: 42,
    artist: 'Metallica',
    title: 'Master of Puppets',
    hasChords: true,
    tracks: [
      { instrument: 'Electric Guitar', tuning: [64, 59, 55, 50, 45, 40], difficulty: 3, views: 10 },
      { instrument: 'Electric Bass', tuning: [43, 38, 33, 28], difficulty: 2 },
      { instrument: 'Electric Guitar', tuning: [64, 59, 55, 50, 45, 38] },
    ],
  },
  // Songsterr fuzzy-matches single words: this one is noise.
  { songId: 7, artist: 'Avenged Sevenfold', title: 'Nobody', tracks: [] },
  { songId: 'nope', title: 'Bad row' },
  null,
];

describe('parseSongs', () => {
  it('keeps relevant, well-formed songs with tuning per track', () => {
    const songs = parseSongs(RAW, 'Master of Puppets (Remastered)', 'Metallica');
    expect(songs).toHaveLength(1);
    expect(songs[0]).toEqual({
      songId: 42,
      artist: 'Metallica',
      title: 'Master of Puppets',
      hasChords: true,
      tracks: [
        { instrument: 'Electric Guitar', tuning: [64, 59, 55, 50, 45, 40], difficulty: 3 },
        { instrument: 'Electric Bass', tuning: [43, 38, 33, 28], difficulty: 2 },
        { instrument: 'Electric Guitar', tuning: [64, 59, 55, 50, 45, 38], difficulty: null },
      ],
    });
  });

  it('reads anything that is not an array as no songs', () => {
    expect(parseSongs({ error: 'x' }, 'a', 'b')).toEqual([]);
  });

  it('caps at eight songs', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ songId: i, title: 'Master of Puppets', artist: 'Metallica' }));
    expect(parseSongs(many, 'Master of Puppets', 'Metallica')).toHaveLength(8);
  });
});

describe('matches and hints', () => {
  it('builds link-out matches with distinct instruments', () => {
    const [m] = toMatches(parseSongs(RAW, 'Master of Puppets', 'Metallica'));
    expect(m).toEqual({
      id: 42,
      artist: 'Metallica',
      title: 'Master of Puppets',
      hasChords: true,
      instruments: ['Electric Guitar', 'Electric Bass'],
      url: 'https://www.songsterr.com/a/wsa/metallica-master-of-puppets-tab-s42',
    });
  });

  it('round-trips hints, and reads malformed ones as none', () => {
    const songs = parseSongs(RAW, 'Master of Puppets', 'Metallica');
    const hints = toHints(songs, new Date('2026-09-18T00:00:00Z'));
    expect(readHints(JSON.parse(JSON.stringify(hints)))).toEqual(hints);
    expect(readHints(null)).toBeNull();
    expect(readHints({ source: 'other', songs: [] })).toBeNull();
    expect(readHints({ source: 'songsterr' })).toBeNull();
  });
});

describe('searchSongsterr', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    clearSongsterrCache();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    process.env.SONGSTERR_BASE = 'http://fake-songsterr.test/';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SONGSTERR_BASE;
  });

  it('asks SONGSTERR_BASE with artist first, and caches the answer in memory', async () => {
    fetchMock.mockResolvedValue(Response.json(RAW));
    const songs = await searchSongsterr('Master of Puppets', 'Metallica');
    expect(songs?.map((s) => s.songId)).toEqual([42]);
    expect(fetchMock.mock.calls[0][0]).toBe('http://fake-songsterr.test/api/songs?pattern=Metallica%20Master%20of%20Puppets');

    await searchSongsterr('Master of Puppets', 'Metallica');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null (not "no tabs") when Songsterr fails, and does not cache it', async () => {
    fetchMock.mockResolvedValueOnce(new Response('busy', { status: 503 }));
    expect(await searchSongsterr('One', 'Metallica')).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await searchSongsterr('One', 'Metallica')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
