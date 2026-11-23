import { artistKey } from '../genres/artistKey';
import { songSignal } from '../genres/songSignal';
import type { Track } from '../../types/track';
import type { GenreOf } from './build';

/** One song's genre for the mixes (docs/mixes.md, "Game & Anime"): the
 *  artist's family, unless the song itself says it is game or anime music.
 *  Pure. First match wins:
 *
 *  1. an admin's row for the artist: their word (a family, or none);
 *  2. a strong title signal: Game & Anime, whatever the artist's tags say;
 *  3. the artist's family (tags or a chart prior);
 *  4. a weak title signal ("OST"): Game & Anime, only for an artist with no
 *     family, so a film composer's "(Original Soundtrack)" stays Classical;
 *  5. nothing: untagged. */

export type GenreVia = 'manual' | 'signal' | 'tags' | 'weak-signal' | null;

export interface SongGenre extends GenreOf {
  via: GenreVia;
}

/** `key` is the artist key when the caller already has it (a SongScore's). */
export function resolveGenre(
  track: Pick<Track, 'title' | 'artist' | 'album'>,
  genres: ReadonlyMap<string, GenreOf>,
  key: string = artistKey(track.artist),
): SongGenre {
  const g = genres.get(key);
  if (g?.manual) return { family: g.family, sub: g.family ? g.sub : null, manual: true, via: 'manual' };
  const signal = songSignal(track);
  if (signal === 'strong') return { family: 'game-anime', sub: null, via: 'signal' };
  if (g?.family) return { family: g.family, sub: g.sub, via: 'tags' };
  if (signal === 'weak') return { family: 'game-anime', sub: null, via: 'weak-signal' };
  return { family: null, sub: null, via: null };
}
