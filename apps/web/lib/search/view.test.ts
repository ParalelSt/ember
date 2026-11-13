import { describe, expect, it } from 'vitest';
import type { Track } from '@/types/track';
import { addSearchChunk, EMPTY_SEARCH_PARTS, type SearchArtist, type SearchChunk, type SearchParts } from './types';
import { ARTISTS_AFTER_SONGS, buildSearchView, SONG_CAP, YOUTUBE_TOTAL, type SearchView } from './view';

const t = (id: string, title = id, artist = 'Someone'): Track => ({
  id,
  source: id.startsWith('upload:') ? 'upload' : 'youtube',
  sourceId: id,
  title,
  artist,
  artistId: null,
  album: null,
  albumId: null,
  durationSec: 200,
  artworkUrl: null,
  streamUrl: '',
});
const artist = (name: string): SearchArtist => ({ id: `UC${name}`, name, artworkUrl: null });
const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => t(`${prefix}${i}`));

/** The view as a short readable list: track ids, and "ARTISTS" where the
 *  section is. */
const shape = (v: SearchView) => v.rows.map((r) => (r.kind === 'artists' ? 'ARTISTS' : r.track.id));

const parts = (p: Partial<SearchParts>): SearchParts => ({ ...EMPTY_SEARCH_PARTS, ...p });

describe('buildSearchView: order', () => {
  it('own matches, uploads, songs, then videos', () => {
    const v = buildSearchView('x', parts({
      uploads: [t('upload:u1')],
      artists: [],
      songs: [t('s1')],
      videos: [t('v1')],
    }), [t('own1')]);
    expect(shape(v)).toEqual(['own1', 'upload:u1', 's1', 'v1']);
    expect(v.tracks.map((x) => x.id)).toEqual(['own1', 'upload:u1', 's1', 'v1']);
  });

  it('a direct artist search puts Artists above the songs', () => {
    const v = buildSearchView('demetori', parts({
      uploads: [],
      artists: [artist('Demetori'), artist('Demetori Tribute')],
      songs: many('s', 5),
      videos: [],
    }));
    expect(v.artistsOnTop).toBe(true);
    expect(shape(v)).toEqual(['ARTISTS', 's0', 's1', 's2', 's3', 's4']);
  });

  it('own matches still lead a direct artist search (they are there before the artists are)', () => {
    const v = buildSearchView('demetori', parts({ uploads: [], artists: [artist('Demetori')], songs: [t('s0')], videos: [] }), [t('own1')]);
    expect(shape(v)).toEqual(['own1', 'ARTISTS', 's0']);
  });

  it('otherwise Artists go under the first few songs', () => {
    const v = buildSearchView('necro fantasia', parts({
      uploads: [],
      artists: [artist('Demetori')],
      songs: many('s', 5),
      videos: [t('v0')],
    }));
    expect(v.artistsOnTop).toBe(false);
    expect(shape(v)).toEqual([...many('s', ARTISTS_AFTER_SONGS).map((x) => x.id), 'ARTISTS', 's3', 's4', 'v0']);
  });

  it('at most 3 artists', () => {
    const v = buildSearchView('a', parts({ uploads: [], artists: ['a', 'b', 'c', 'd'].map(artist), songs: [] }));
    const row = v.rows.find((r) => r.kind === 'artists');
    expect(row?.kind === 'artists' && row.artists.map((a) => a.name)).toEqual(['a', 'b', 'c']);
  });

  it('no artists, no section', () => {
    const v = buildSearchView('x', parts({ uploads: [], artists: [], songs: [t('s0')], videos: [] }));
    expect(shape(v)).toEqual(['s0']);
  });

  it('re-ranks songs and videos separately: full matches first, stable otherwise', () => {
    const v = buildSearchView('necro demetori', parts({
      uploads: [],
      artists: [],
      songs: [t('s0', 'Other'), t('s1', 'Necro Fantasia', 'Demetori'), t('s2', 'Else')],
      videos: [t('v0', 'Video'), t('v1', 'Demetori - Necro')],
    }));
    expect(shape(v)).toEqual(['s1', 's0', 's2', 'v1', 'v0']);
  });

  it('a track already shown is not shown again', () => {
    const v = buildSearchView('x', parts({ uploads: [], artists: [], songs: [t('own1'), t('s1')], videos: [t('s1'), t('v1')] }), [t('own1')]);
    expect(shape(v)).toEqual(['own1', 's1', 'v1']);
  });

  it('caps YouTube at 20 songs and 30 rows in all, videos filling what songs leave', () => {
    const full = buildSearchView('x', parts({ uploads: [], artists: [], songs: many('s', 30), videos: many('v', 30) }));
    expect(full.tracks.filter((x) => x.id.startsWith('s'))).toHaveLength(SONG_CAP);
    expect(full.tracks).toHaveLength(YOUTUBE_TOTAL);
    const fewSongs = buildSearchView('x', parts({ uploads: [], artists: [], songs: many('s', 4), videos: many('v', 30) }));
    expect(fewSongs.tracks.filter((x) => x.id.startsWith('v'))).toHaveLength(YOUTUBE_TOTAL - 4);
  });
});

describe('buildSearchView: no song matches the query', () => {
  const songs = [t('s0', 'Necro Fantasia', 'Alstroemeria'), t('s1', 'Border of Life', 'coorifime')];
  const videos = [t('v0', 'Touhou mix', 'someone'), t('v1', 'Demetori - Plastic Mind', 'vicildur'), t('v2', 'Demetori - Suwa', 'vicildur')];

  it('the songs wait for the videos', () => {
    expect(shape(buildSearchView('demetori', parts({ uploads: [], artists: [], songs })))).toEqual([]);
  });

  it('then the videos that match go above the songs, in their own order', () => {
    const v = buildSearchView('demetori', parts({ uploads: [], artists: [], songs, videos }));
    expect(shape(v)).toEqual(['v1', 'v2', 's0', 's1', 'v0']);
  });

  it('songs that do match never wait for videos', () => {
    const matching = [...songs, t('m0', 'Demetori - Septette')];
    expect(shape(buildSearchView('demetori', parts({ uploads: [], artists: [], songs: matching })))).toEqual(['m0', 's0', 's1']);
  });
});

describe('buildSearchView: arriving one group at a time', () => {
  it('only grows at the end as groups arrive (nothing on screen moves)', () => {
    const own = [t('own1')];
    let p: SearchParts = EMPTY_SEARCH_PARTS;
    const steps: string[][] = [shape(buildSearchView('necro', p, own))];
    const chunks: SearchChunk[] = [
      { type: 'uploads', tracks: [t('upload:u1')] },
      { type: 'artists', artists: [artist('Demetori')] },
      { type: 'songs', tracks: many('s', 5) },
      { type: 'videos', tracks: [t('v0')] },
      { type: 'done' },
    ];
    for (const chunk of chunks) {
      p = addSearchChunk(p, chunk);
      steps.push(shape(buildSearchView('necro', p, own)));
    }
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].slice(0, steps[i - 1].length)).toEqual(steps[i - 1]);
    }
    expect(steps.at(-1)).toEqual(['own1', 'upload:u1', 's0', 's1', 's2', 'ARTISTS', 's3', 's4', 'v0']);
  });

  it('own matches show before the server has answered anything', () => {
    expect(shape(buildSearchView('x', EMPTY_SEARCH_PARTS, [t('own1')]))).toEqual(['own1']);
  });

  it('songs wait for uploads, and videos wait for songs', () => {
    expect(shape(buildSearchView('x', parts({ songs: [t('s0')], videos: [t('v0')] })))).toEqual([]);
    expect(shape(buildSearchView('x', parts({ uploads: [], videos: [t('v0')] })))).toEqual([]);
  });

  it('a non-direct Artists section waits for the songs it sits under', () => {
    expect(shape(buildSearchView('necro', parts({ uploads: [], artists: [artist('Demetori')] })))).toEqual([]);
  });
});

describe('addSearchChunk', () => {
  it('an older server’s one-shot answer is shown as given, every group done', () => {
    const p = addSearchChunk(EMPTY_SEARCH_PARTS, { type: 'legacy', tracks: many('x', 30) });
    expect(p.done).toBe(true);
    const v = buildSearchView('', p);
    expect(v.tracks).toHaveLength(30);
  });

  it('keeps an error next to what already arrived', () => {
    let p = addSearchChunk(EMPTY_SEARCH_PARTS, { type: 'uploads', tracks: [t('upload:u1')] });
    p = addSearchChunk(p, { type: 'error', status: 502, error: 'down' });
    expect(p.uploads).toHaveLength(1);
    expect(p.error).toEqual({ status: 502, error: 'down' });
  });
});
