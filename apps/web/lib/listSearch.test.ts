import { describe, expect, it } from 'vitest';
import { filterTracks, foldText } from './listSearch';
import type { Track } from '@/types/track';

function t(id: string, title: string, artist: string, album: string | null = null): Track {
  return { id, source: 'youtube', sourceId: id, title, artist, artistId: null, album, albumId: null, durationSec: 1, artworkUrl: null, streamUrl: '' };
}
const list = [
  t('1', 'Čežnja', 'Đorđe Balašević', 'Panonski mornar'),
  t('2', 'Halo', 'Beyoncé, Jay-Z', 'I Am... Sasha Fierce'),
  t('3', 'Zora', 'Šaban', null),
];

describe('foldText', () => {
  it('folds Croatian letters and accents', () => {
    expect(foldText('čćšž đ Đ É')).toBe('ccsz d d e');
  });
});

describe('filterTracks', () => {
  it('returns the same list for an empty or blank query', () => {
    expect(filterTracks(list, '')).toBe(list);
    expect(filterTracks(list, '   ')).toBe(list);
  });
  it('matches title case- and accent-insensitively', () => {
    expect(filterTracks(list, 'cezn').map((x) => x.id)).toEqual(['1']);
    expect(filterTracks(list, 'ČEŽ').map((x) => x.id)).toEqual(['1']);
  });
  it('folds đ: "dorde" finds Đorđe', () => {
    expect(filterTracks(list, 'dorde').map((x) => x.id)).toEqual(['1']);
  });
  it('matches any artist of a multi-artist song', () => {
    expect(filterTracks(list, 'jay-z').map((x) => x.id)).toEqual(['2']);
    expect(filterTracks(list, 'beyonce').map((x) => x.id)).toEqual(['2']);
  });
  it('matches the album, and tolerates a null album', () => {
    expect(filterTracks(list, 'panonski').map((x) => x.id)).toEqual(['1']);
    expect(filterTracks(list, 'null')).toEqual([]);
  });
  it('does not match across fields', () => {
    expect(filterTracks(list, 'halobeyonce')).toEqual([]);
  });
  it('returns nothing when nothing matches', () => {
    expect(filterTracks(list, 'zzz')).toEqual([]);
  });
});
