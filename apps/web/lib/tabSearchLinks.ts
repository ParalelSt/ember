import type { TabMatch } from '@/lib/songsterr';

/** Where to look for a tab by hand (docs/tab-sources.md section 3). Links
 *  only: the browser opens them, Ember never fetches any of these sites.
 *  The listener finds a tab there and copies or downloads it themselves. */

export interface TabSearchLink {
  id: 'ultimate-guitar' | 'guitar-pro' | 'songsterr';
  /** Chip text in the empty state. */
  label: string;
  /** Menu item text. */
  menuLabel: string;
  url: string;
}

/** "artist title", the way people type it into a search box. An unknown
 *  artist is left out rather than searched for. */
export function searchQuery(song: { title: string; artist: string }): string {
  const artist = song.artist.trim();
  const known = artist && artist.toLowerCase() !== 'unknown artist';
  return `${known ? `${artist} ` : ''}${song.title.trim()}`.trim();
}

/** Form-style encoding: spaces as `+`, everything else percent-encoded. */
function encode(q: string): string {
  return encodeURIComponent(q).replace(/%20/g, '+');
}

export function ultimateGuitarUrl(q: string): string {
  return `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encode(q)}`;
}

export function guitarProSearchUrl(q: string): string {
  return `https://duckduckgo.com/?q=${encode(q)}+(gp5+OR+gpx+OR+"guitar+pro")`;
}

/** Songsterr's own page for the song when the search found it, else its
 *  search for the song. */
export function songsterrUrl(q: string, match: TabMatch | null | undefined): string {
  return match?.url ?? `https://www.songsterr.com/?pattern=${encode(q)}`;
}

export function tabSearchLinks(song: { title: string; artist: string }, matches: TabMatch[] = []): TabSearchLink[] {
  const q = searchQuery(song);
  return [
    { id: 'ultimate-guitar', label: 'Ultimate Guitar', menuLabel: 'Search Ultimate Guitar', url: ultimateGuitarUrl(q) },
    { id: 'guitar-pro', label: 'Guitar Pro files', menuLabel: 'Search Guitar Pro files', url: guitarProSearchUrl(q) },
    { id: 'songsterr', label: 'Songsterr', menuLabel: 'Open on Songsterr', url: songsterrUrl(q, matches[0]) },
  ];
}
