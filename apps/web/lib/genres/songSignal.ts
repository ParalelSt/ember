import type { Track } from '../../types/track';
import { foldText, hasCjkSceneWord, NAMED_RE, wholeWords } from './gameAnimeWords';

/** Whether a song says in its own words that it is game or anime music
 *  (docs/mixes.md, "Game & Anime"): "(ULTRAKILL Soundtrack)", "[BOF:NT]",
 *  "feat. 初音ミク", an album called "Arcaea Sound Collection". Pure; read
 *  at build time from the title, album and artist every Track carries, so
 *  nothing is stored.
 *
 *  - strong: a named game, rhythm game or scene word, a Japanese scene word,
 *    or "video game" / "game OST" style words, in the title or album. Never
 *    cancelled.
 *  - weak: some kind of soundtrack ("OST", "Original Soundtrack", "Boss
 *    Theme", "BGM", "chiptune"), in the title, album or the uploader's name.
 *    Cancelled by a film or stage word ("Motion Picture", "film", "Netflix").
 *  - null: nothing. */

export type SongSignal = 'strong' | 'weak' | null;

const STRONG_RE = wholeWords([
  'video ?games?',
  'games? (?:ost|soundtracks?|music|rip)',
  'original game soundtrack',
  // BMS event tags: BOF2011, BOFU2016, BOFXV, BOF:NT, BOF:ET.
  'bof(?:u\\d*|\\d+|x[vi]*|:[a-z]{2,3})?',
], true);

const WEAK_RE = wholeWords([
  'ost', 'o\\.s\\.t\\.?', 'original soundtracks?', 'soundtracks?', 'bgm', 'boss (?:theme|battle|fight)', 'battle theme',
  'chiptunes?', '8 ?bit',
], true);

const SCREEN_RE = wholeWords([
  'motion picture', 'films?', 'movies?', 'musicals?', 'broadway', 'drama', 'bollywood', 'netflix', 'cast recording', 'tv series',
], true);

export function songSignal(t: Pick<Track, 'title' | 'artist' | 'album'>): SongSignal {
  const titleAlbum = foldText(`${t.title ?? ''} | ${t.album ?? ''}`);
  if (NAMED_RE.test(titleAlbum) || hasCjkSceneWord(titleAlbum) || STRONG_RE.test(titleAlbum)) return 'strong';
  const all = foldText(`${t.title ?? ''} | ${t.album ?? ''} | ${t.artist ?? ''}`);
  if (WEAK_RE.test(all) && !SCREEN_RE.test(all)) return 'weak';
  return null;
}
