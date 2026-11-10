import { describe, expect, it } from 'vitest';
import type { Track } from '@/types/track';
import {
  isDirectArtistSearch,
  localMatches,
  matchesAllWords,
  normalizeForSearch,
  queryWords,
  rankByQuery,
} from './rank';

const t = (id: string, title: string, artist = 'Someone', source: Track['source'] = 'youtube'): Track => ({
  id,
  source,
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

describe('normalizeForSearch / queryWords', () => {
  it('drops case, accents and extra spaces', () => {
    expect(normalizeForSearch('  Motörhead   ÉTÉ ')).toBe('motorhead ete');
  });

  it('splits on spaces and punctuation, in any script', () => {
    expect(queryWords('AC/DC  back-in black')).toEqual(['ac', 'dc', 'back', 'in', 'black']);
    expect(queryWords('東方 project')).toEqual(['東方', 'project']);
    expect(queryWords('   ')).toEqual([]);
  });
});

describe('matchesAllWords', () => {
  it('needs every word, from the title or the artist', () => {
    const song = t('1', 'Necro Fantasia', 'Demetori');
    expect(matchesAllWords(song, queryWords('demetori necro'))).toBe(true);
    expect(matchesAllWords(song, queryWords('demetori septette'))).toBe(false);
  });

  it('matches part of a word and ignores accents', () => {
    expect(matchesAllWords(t('1', 'Ace of Spades', 'Motörhead'), queryWords('motor ace'))).toBe(true);
  });

  it('an empty query matches nothing', () => {
    expect(matchesAllWords(t('1', 'Anything'), [])).toBe(false);
  });
});

describe('rankByQuery', () => {
  it('moves full matches up and keeps the order otherwise (stable)', () => {
    const list = [
      t('a', 'Unrelated One'),
      t('b', 'Necro Fantasia', 'Demetori'),
      t('c', 'Unrelated Two'),
      t('d', 'Demetori live', 'Necro Fan'),
      t('e', 'Necro only'),
    ];
    expect(rankByQuery(list, 'necro demetori').map((x) => x.id)).toEqual(['b', 'd', 'a', 'c', 'e']);
  });

  it('leaves the list alone for an empty query', () => {
    const list = [t('a', 'x'), t('b', 'y')];
    expect(rankByQuery(list, '  ')).toBe(list);
  });

  it('does not change the input array', () => {
    const list = [t('a', 'x'), t('b', 'needle')];
    rankByQuery(list, 'needle');
    expect(list.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('isDirectArtistSearch', () => {
  it.each([
    ['demetori', 'Demetori'],
    ['DEMETORI', 'Demetori'],
    ['  demetori ', 'Demetori'],
    ['motorhead', 'Motörhead'],
    ['acdc', 'AC/DC'],
    ['ac dc', 'AC/DC'],
    ['daftpunk', 'Daft Punk'],
    ['beatles', 'The Beatles'],
    ['demetory', 'Demetori'],
    ['metalica', 'Metallica'],
    ['red hot chilli peppers', 'Red Hot Chili Peppers'],
  ])('"%s" is a direct search for %s', (q, name) => {
    expect(isDirectArtistSearch(q, name)).toBe(true);
  });

  it.each([
    ['demetori necro fantasia', 'Demetori'],
    ['necro fantasia', 'Demetori'],
    ['abba', 'Abbe'],
    ['sia', 'Sid'],
    ['', 'Demetori'],
    ['demetori', ''],
  ])('"%s" is not a direct search for "%s"', (q, name) => {
    expect(isDirectArtistSearch(q, name)).toBe(false);
  });
});

describe('localMatches', () => {
  const liked = [t('l1', 'Necro Fantasia', 'Demetori'), t('l2', 'Other', 'Band')];
  const recent = [t('l1', 'Necro Fantasia', 'Demetori'), t('r1', 'Demetori Live', 'X')];
  const stations = [t('s1', 'Demetori FM', 'Radio', 'station')];

  it('keeps list order, each song once, no stations', () => {
    expect(localMatches('demetori', [liked, recent, stations]).map((x) => x.id)).toEqual(['l1', 'r1']);
  });

  it('stops at max', () => {
    expect(localMatches('demetori', [liked, recent], 1).map((x) => x.id)).toEqual(['l1']);
  });

  it('nothing for an empty query or missing lists', () => {
    expect(localMatches('', [liked])).toEqual([]);
    expect(localMatches('demetori', [undefined, null])).toEqual([]);
  });
});
