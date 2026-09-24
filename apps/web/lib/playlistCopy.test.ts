import { describe, expect, it } from 'vitest';
import type { Track } from '@/types/track';
import {
  DEFAULT_LIKED_SORT,
  DEFAULT_PLAYLIST_SORT,
  alreadyCount,
  alreadyThere,
  isSortState,
  planCopy,
  resultLine,
  skipLine,
  sortCollection,
  sortLabel,
  sortTracks,
  toSkip,
  type SortableTrack,
} from './playlistCopy';

function t(id: string, title: string, artist: string, extra: Partial<SortableTrack> = {}): SortableTrack {
  return {
    id,
    source: 'youtube',
    sourceId: id,
    title,
    artist,
    artistId: null,
    album: null,
    albumId: null,
    durationSec: 200,
    artworkUrl: null,
    streamUrl: '',
    addedAt: '2026-06-01T00:00:00.000Z',
    ...extra,
  };
}

describe('the duplicate rule (alreadyThere)', () => {
  it('matches the same track by id', () => {
    const a = t('youtube:a', 'Slow Static', 'Aftertone');
    expect(alreadyThere(a, [a])).toBe(a);
  });

  it('matches another upload of the same song (noise in the title, a Topic channel)', () => {
    const song = t('youtube:a', 'Harbor Lights', 'Coastline');
    const video = t('youtube:b', 'Harbor Lights (Official Video)', 'Coastline - Topic');
    expect(alreadyThere(song, [video])).toBe(video);
  });

  it('never matches two different songs that only share a title', () => {
    expect(alreadyThere(t('youtube:a', 'Home', 'Edward Sharpe'), [t('youtube:b', 'Home', 'Phillip Phillips')])).toBeNull();
    expect(alreadyThere(t('youtube:c', 'Звезда', 'Виктор Цой'), [t('youtube:d', 'Звезда', 'Другая Группа')])).toBeNull();
    expect(alreadyThere(t('upload:e', 'Home', ''), [t('upload:f', 'Home', '')])).toBeNull();
    expect(alreadyThere(t('upload:e', 'Home', ''), [t('youtube:g', 'Home', 'Edward Sharpe')])).toBeNull();
  });

  it('keeps a live, remix or instrumental version apart from the studio one', () => {
    const studio = t('youtube:a', 'Northbound', 'The Nulls');
    for (const title of ['Northbound (Live)', 'Northbound (Remix)', 'Northbound (Instrumental)', 'Northbound (Acoustic)', 'Northbound (Sped Up)']) {
      expect(alreadyThere(studio, [t('youtube:b', title, 'The Nulls')]), title).toBeNull();
    }
  });

  it('matches a non-Latin song against its own official video', () => {
    const song = t('youtube:a', 'Звезда', 'Виктор Цой');
    expect(alreadyThere(song, [t('youtube:b', 'Звезда (Official Video)', 'Виктор Цой')])).not.toBeNull();
  });
});

// The plan's section 1 table, row by row: [picked, already in the
// destination, duplicate?, reason].
const TABLE: [string, SortableTrack, SortableTrack, 'same-track' | 'other-version' | null][] = [
  ['same track id', t('youtube:x', 'Slow Static', 'Aftertone'), t('youtube:x', 'Slow Static', 'Aftertone'), 'same-track'],
  ['bracket noise + Topic channel', t('youtube:a', 'Harbor Lights', 'Coastline'), t('youtube:b', 'Harbor Lights (Official Video)', 'Coastline - Topic'), 'other-version'],
  ['same title, different artist', t('youtube:a', 'Home', 'Edward Sharpe'), t('youtube:b', 'Home', 'Phillip Phillips'), null],
  ['non-Latin title, different artist', t('youtube:a', 'Звезда', 'Виктор Цой'), t('youtube:b', 'Звезда', 'Другая Группа'), null],
  ['non-Latin title, its official video', t('youtube:a', 'Звезда', 'Виктор Цой'), t('youtube:b', 'Звезда (Official Video)', 'Виктор Цой'), 'other-version'],
  ['two artist-less uploads called Home', t('upload:a', 'Home', ''), t('upload:b', 'Home', ''), null],
  ['live version', t('youtube:a', 'Northbound', 'The Nulls'), t('youtube:b', 'Northbound (Live)', 'The Nulls'), null],
  ['remix', t('youtube:a', 'Northbound', 'The Nulls'), t('youtube:b', 'Northbound (Remix)', 'The Nulls'), null],
  ['instrumental', t('youtube:a', 'Northbound', 'The Nulls'), t('youtube:b', 'Northbound (Instrumental)', 'The Nulls'), null],
  ['acoustic', t('youtube:a', 'Northbound', 'The Nulls'), t('youtube:b', 'Northbound (Acoustic)', 'The Nulls'), null],
  ['sped up', t('youtube:a', 'Northbound', 'The Nulls'), t('youtube:b', 'Northbound (Sped Up)', 'The Nulls'), null],
];

describe('the plan table', () => {
  for (const [name, picked, there, reason] of TABLE) {
    it(`${name}: ${reason ?? 'not a duplicate'}`, () => {
      const plan = planCopy([picked], [there]);
      if (reason) {
        expect(plan.add).toEqual([]);
        expect(plan.skipped).toEqual([{ track: picked, existing: there, reason }]);
      } else {
        expect(plan.add).toEqual([picked]);
        expect(plan.skipped).toEqual([]);
      }
    });
  }

  it('picking the same song twice adds it once (picked-twice)', () => {
    const a = t('youtube:a', 'Harbor Lights', 'Coastline');
    const b = t('youtube:b', 'Harbor Lights [Lyrics]', 'Coastline');
    const plan = planCopy([a, b], []);
    expect(plan.add).toEqual([a]);
    expect(plan.skipped).toEqual([{ track: b, existing: a, reason: 'picked-twice' }]);
    // The very same track id picked twice too.
    expect(planCopy([a, a], []).skipped.map((s) => s.reason)).toEqual(['picked-twice']);
  });

  it('never puts a song in both add and skipped, and accounts for every pick', () => {
    const picked = TABLE.map(([, p]) => p);
    const destination = TABLE.map(([, , d]) => d);
    const plan = planCopy([...picked, ...picked.map((p) => ({ ...p }))], destination);
    const added = new Set(plan.add);
    for (const s of plan.skipped) expect(added.has(s.track)).toBe(false);
    expect(plan.add.length + plan.skipped.length).toBe(picked.length * 2);
  });
});

describe('planCopy', () => {
  const source = [
    t('youtube:1', 'Slow Static', 'Aftertone'),
    t('youtube:2', 'Harbor Lights', 'Coastline'),
    t('youtube:3', 'Home', 'Edward Sharpe'),
    t('youtube:4', 'Northbound', 'The Nulls'),
    t('youtube:5', 'Night Swim', 'Pale Harbor'),
  ];
  const liked = [
    t('youtube:1', 'Slow Static', 'Aftertone'),
    t('youtube:9', 'Harbor Lights (Official Video)', 'Coastline - Topic'),
    t('youtube:8', 'Home', 'Phillip Phillips'),
    t('youtube:7', 'Northbound (Live)', 'The Nulls'),
  ];

  it('into Liked songs: added 3, skipped 2 already there, in the picked order', () => {
    const plan = planCopy(source, liked);
    expect(plan.add.map((s) => s.id)).toEqual(['youtube:3', 'youtube:4', 'youtube:5']);
    expect(plan.skipped.map((s) => [s.track.title, s.reason])).toEqual([
      ['Slow Static', 'same-track'],
      ['Harbor Lights', 'other-version'],
    ]);
    expect(resultLine({ added: plan.add.length, skipped: plan.skipped })).toBe('Added 3, skipped 2 already there');
    expect(alreadyCount(source, liked)).toBe(2);
  });

  it('says nothing about skipping when nothing was', () => {
    expect(resultLine({ added: 3, skipped: [] })).toBe('Added 3');
  });

  it('alreadyCount leaves out a song picked twice', () => {
    const a = t('youtube:a', 'Harbor Lights', 'Coastline');
    expect(alreadyCount([a, a], [])).toBe(0);
  });

  it('explains each skip in plain words, from the route shape too', () => {
    const song = t('youtube:a', 'Harbor Lights', 'Coastline');
    const video: Track = t('youtube:b', 'Harbor Lights (Official Video)', 'Coastline - Topic');
    expect(skipLine(toSkip({ track: song, existing: song, reason: 'same-track' }))).toBe('already there');
    expect(skipLine(toSkip({ track: song, existing: video, reason: 'other-version' }))).toBe(
      'already there as "Harbor Lights (Official Video)"',
    );
    expect(skipLine(toSkip({ track: video, existing: song, reason: 'picked-twice' }))).toBe('picked twice, added once');
    expect(toSkip({ track: song, existing: video, reason: 'other-version' })).toEqual({
      id: 'youtube:a',
      title: 'Harbor Lights',
      artist: 'Coastline',
      reason: 'other-version',
      existingTitle: 'Harbor Lights (Official Video)',
    });
  });
});

describe('sortTracks', () => {
  const list = [
    t('1', 'beta', 'Zed', { durationSec: 300, addedAt: '2026-06-03T00:00:00.000Z' }),
    t('2', 'Alpha', 'amy', { durationSec: 100, addedAt: '2026-06-01T00:00:00.000Z' }),
    t('3', 'Gamma', 'Amy', { durationSec: 200, addedAt: '2026-06-02T00:00:00.000Z' }),
  ];
  const ids = (xs: SortableTrack[]) => xs.map((x) => x.id);

  it('sorts by title, artist, date added and duration, both ways, ignoring case', () => {
    expect(ids(sortTracks(list, { key: 'title', dir: 'asc' }))).toEqual(['2', '1', '3']);
    expect(ids(sortTracks(list, { key: 'title', dir: 'desc' }))).toEqual(['3', '1', '2']);
    expect(ids(sortTracks(list, { key: 'artist', dir: 'asc' }))).toEqual(['2', '3', '1']);
    expect(ids(sortTracks(list, { key: 'artist', dir: 'desc' }))).toEqual(['1', '3', '2']);
    expect(ids(sortTracks(list, { key: 'added', dir: 'asc' }))).toEqual(['2', '3', '1']);
    expect(ids(sortTracks(list, { key: 'added', dir: 'desc' }))).toEqual(['1', '3', '2']);
    expect(ids(sortTracks(list, { key: 'duration', dir: 'asc' }))).toEqual(['2', '3', '1']);
    expect(ids(sortTracks(list, { key: 'duration', dir: 'desc' }))).toEqual(['1', '3', '2']);
  });

  it('never changes the input and keeps ties in list order both ways', () => {
    const tied = [t('a', 'Same', 'X'), t('b', 'Same', 'X'), t('c', 'Same', 'X')];
    const before = ids(tied);
    expect(ids(sortTracks(tied, { key: 'title', dir: 'asc' }))).toEqual(['a', 'b', 'c']);
    expect(ids(sortTracks(tied, { key: 'title', dir: 'desc' }))).toEqual(['a', 'b', 'c']);
    expect(ids(tied)).toEqual(before);
  });

  it('a song with no time yet counts as just added', () => {
    const fresh = t('new', 'Zzz', 'Q', { addedAt: undefined });
    expect(ids(sortTracks([fresh, ...list], { key: 'added', dir: 'asc' })).at(-1)).toBe('new');
    expect(ids(sortTracks([...list, fresh], { key: 'added', dir: 'desc' }))[0]).toBe('new');
  });

  it("sortCollection keeps the server's own order for the default", () => {
    const server = [list[2], list[0], list[1]];
    expect(sortCollection(server, DEFAULT_PLAYLIST_SORT, DEFAULT_PLAYLIST_SORT)).toBe(server);
    expect(ids(sortCollection(server, { key: 'title', dir: 'asc' }, DEFAULT_PLAYLIST_SORT))).toEqual(['2', '1', '3']);
    // Oldest first is a real sort on Liked songs, whose default is newest first.
    expect(ids(sortCollection(server, DEFAULT_PLAYLIST_SORT, DEFAULT_LIKED_SORT))).toEqual(['2', '3', '1']);
  });

  it('labels and validates a stored sort', () => {
    expect(sortLabel({ key: 'artist', dir: 'desc' })).toBe('Artist, Z to A');
    expect(isSortState({ key: 'duration', dir: 'asc' })).toBe(true);
    expect(isSortState({ key: 'plays', dir: 'asc' })).toBe(false);
    expect(isSortState({ key: 'title', dir: 'up' })).toBe(false);
    expect(isSortState(null)).toBe(false);
  });
});
