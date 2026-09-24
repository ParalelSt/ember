import { describe, expect, it } from 'vitest';
import type { Track } from '@/types/track';
import { alreadyThere, planCopy, resultLine, skipLine, sortTracks, type CopyTrack } from './model';
import { MOCK_COPY_LIKED, MOCK_COPY_PLAYLISTS, MOCK_COPY_SOURCE, MOCK_PICKED_IDS } from './mock';

function t(id: string, title: string, artist: string, extra: Partial<CopyTrack> = {}): CopyTrack {
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
    // Non-Latin artists: the same-title fix keeps them apart.
    expect(alreadyThere(t('youtube:c', 'Звезда', 'Виктор Цой'), [t('youtube:d', 'Звезда', 'Другая Группа')])).toBeNull();
    // No artist at all is not an identity.
    expect(alreadyThere(t('upload:e', 'Home', ''), [t('upload:f', 'Home', '')])).toBeNull();
    expect(alreadyThere(t('upload:e', 'Home', ''), [t('youtube:g', 'Home', 'Edward Sharpe')])).toBeNull();
  });

  it('keeps a live, remix or instrumental version apart from the studio one', () => {
    const studio = t('youtube:a', 'Northbound', 'The Nulls');
    for (const title of ['Northbound (Live)', 'Northbound (Remix)', 'Northbound (Instrumental)']) {
      expect(alreadyThere(studio, [t('youtube:b', title, 'The Nulls')])).toBeNull();
    }
  });

  it('matches a non-Latin song against its own official video', () => {
    const song = t('youtube:a', 'Звезда', 'Виктор Цой');
    expect(alreadyThere(song, [t('youtube:b', 'Звезда (Official Video)', 'Виктор Цой')])).not.toBeNull();
  });
});

describe('planCopy', () => {
  it('all 15 mock songs into Liked songs: added 12, skipped 3 already there', () => {
    const plan = planCopy(MOCK_COPY_SOURCE, MOCK_COPY_LIKED);
    expect(plan.add).toHaveLength(12);
    expect(plan.skipped.map((s) => s.track.title)).toEqual(['Slow Static', 'Harbor Lights', 'Звезда']);
    expect(plan.skipped.map((s) => s.reason)).toEqual(['same-track', 'other-version', 'other-version']);
    expect(plan.add.map((s) => s.title)).toContain('Home');
    expect(plan.add.map((s) => s.title)).toContain('Northbound');
    expect(resultLine(plan)).toBe('Added 12, skipped 3 already there');
  });

  it('adds a song picked twice (two uploads of it) only once', () => {
    const a = t('youtube:a', 'Harbor Lights', 'Coastline');
    const b = t('youtube:b', 'Harbor Lights [Lyrics]', 'Coastline');
    const plan = planCopy([a, b], []);
    expect(plan.add).toEqual([a]);
    expect(plan.skipped).toEqual([{ track: b, existing: a, reason: 'picked-twice' }]);
  });

  it('keeps the picked order and says nothing about skipping when nothing was', () => {
    const picked = MOCK_COPY_SOURCE.slice(2, 5);
    const plan = planCopy(picked, []);
    expect(plan.add).toEqual(picked);
    expect(resultLine(plan)).toBe('Added 3');
  });

  it('the mock playlists count what they already hold', () => {
    const picked = MOCK_COPY_SOURCE.filter((s) => MOCK_PICKED_IDS.includes(s.id));
    const gym = MOCK_COPY_PLAYLISTS.find((p) => p.id === 'gym')!;
    const dad = MOCK_COPY_PLAYLISTS.find((p) => p.id === 'dad')!;
    expect(planCopy(picked, gym.tracks).skipped.map((s) => s.track.title)).toEqual(['Night Swim']);
    // For Dad has a different "Home": not a duplicate.
    expect(planCopy(picked, dad.tracks).skipped).toEqual([]);
  });

  it('explains each skip in plain words', () => {
    const song = t('youtube:a', 'Harbor Lights', 'Coastline');
    const video: Track = t('youtube:b', 'Harbor Lights (Official Video)', 'Coastline - Topic');
    expect(skipLine({ track: song, existing: song, reason: 'same-track' })).toBe('already there');
    expect(skipLine({ track: song, existing: video, reason: 'other-version' })).toBe('already there as "Harbor Lights (Official Video)"');
  });
});

describe('sortTracks', () => {
  const list = [
    t('1', 'beta', 'Zed', { durationSec: 300, addedAt: '2026-06-03T00:00:00.000Z' }),
    t('2', 'Alpha', 'amy', { durationSec: 100, addedAt: '2026-06-01T00:00:00.000Z' }),
    t('3', 'Gamma', 'Amy', { durationSec: 200, addedAt: '2026-06-02T00:00:00.000Z' }),
  ];
  const ids = (xs: CopyTrack[]) => xs.map((x) => x.id);

  it('sorts by title, artist, date added and duration, both ways, ignoring case', () => {
    expect(ids(sortTracks(list, { key: 'title', dir: 'asc' }))).toEqual(['2', '1', '3']);
    expect(ids(sortTracks(list, { key: 'title', dir: 'desc' }))).toEqual(['3', '1', '2']);
    expect(ids(sortTracks(list, { key: 'artist', dir: 'asc' }))).toEqual(['2', '3', '1']);
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
});
