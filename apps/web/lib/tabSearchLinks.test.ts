import { describe, expect, it } from 'vitest';
import { guitarProSearchUrl, searchQuery, songsterrUrl, tabSearchLinks, ultimateGuitarUrl } from '@/lib/tabSearchLinks';
import type { TabMatch } from '@/lib/songsterr';

const match: TabMatch = {
  id: 42,
  artist: 'Coastline',
  title: 'Copper Sky',
  hasChords: false,
  instruments: ['Guitar'],
  url: 'https://www.songsterr.com/a/wsa/coastline-copper-sky-tab-s42',
};

describe('searchQuery', () => {
  it('is "artist title"', () => {
    expect(searchQuery({ title: 'Copper Sky', artist: 'Coastline' })).toBe('Coastline Copper Sky');
  });
  it('leaves an unknown artist out', () => {
    expect(searchQuery({ title: 'Copper Sky', artist: '' })).toBe('Copper Sky');
    expect(searchQuery({ title: 'Copper Sky', artist: 'Unknown artist' })).toBe('Copper Sky');
  });
});

describe('search URLs', () => {
  it('Ultimate Guitar: a title search, spaces as +', () => {
    expect(ultimateGuitarUrl('Coastline Copper Sky')).toBe(
      'https://www.ultimate-guitar.com/search.php?search_type=title&value=Coastline+Copper+Sky',
    );
  });

  it('Guitar Pro files: a web search for gp5, gpx or "guitar pro"', () => {
    expect(guitarProSearchUrl('Coastline Copper Sky')).toBe(
      'https://duckduckgo.com/?q=Coastline+Copper+Sky+(gp5+OR+gpx+OR+"guitar+pro")',
    );
  });

  it('encodes characters that would break the query', () => {
    const url = ultimateGuitarUrl('AC/DC Rock & Roll #1 ?');
    expect(url).toBe('https://www.ultimate-guitar.com/search.php?search_type=title&value=AC%2FDC+Rock+%26+Roll+%231+%3F');
    expect(new URL(url).searchParams.get('value')).toBe('AC/DC Rock & Roll #1 ?');
    expect(new URL(guitarProSearchUrl('Motörhead Ace+Spades')).searchParams.get('q')).toBe(
      'Motörhead Ace+Spades (gp5 OR gpx OR "guitar pro")',
    );
  });

  it('Songsterr: the matched song page, else its search', () => {
    expect(songsterrUrl('Coastline Copper Sky', match)).toBe(match.url);
    expect(songsterrUrl('Coastline Copper Sky', null)).toBe('https://www.songsterr.com/?pattern=Coastline+Copper+Sky');
  });
});

describe('tabSearchLinks', () => {
  it('three links in order, the Songsterr one from the first match', () => {
    const links = tabSearchLinks({ title: 'Copper Sky', artist: 'Coastline' }, [match]);
    expect(links.map((l) => l.id)).toEqual(['ultimate-guitar', 'guitar-pro', 'songsterr']);
    expect(links.map((l) => l.menuLabel)).toEqual(['Search Ultimate Guitar', 'Search Guitar Pro files', 'Open on Songsterr']);
    expect(links[2].url).toBe(match.url);
    expect(tabSearchLinks({ title: 'Copper Sky', artist: 'Coastline' })[2].url).toContain('?pattern=Coastline+Copper+Sky');
  });
});
