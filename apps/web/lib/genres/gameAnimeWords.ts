/** The words that say "game or anime music" (docs/mixes.md, "Game & Anime"),
 *  shared by the tag mapper (taxonomy.ts) and the title signal
 *  (songSignal.ts) so the two never disagree. Pure data.
 *
 *  Every entry is in folded form (see foldText): lowercase, no accents,
 *  "-", "_" and "/" read as spaces. Adding a game is one line here plus one
 *  test row in songSignal.test.ts. */

/** Rhythm games and their scenes. "pump it up" is left out on purpose: it is
 *  an ordinary song title. */
export const RHYTHM_GAMES: readonly string[] = [
  'osu!', 'arcaea', 'phigros', 'maimai', 'chunithm', 'sound voltex', 'sdvx', 'beatmania', 'iidx',
  'bms', 'cytus', 'deemo', 'muse dash', 'djmax', 'rotaeno', 'lanota', 'dynamix', 'taiko no tatsujin',
  'project sekai', 'project diva', 'friday night funkin', 'geometry dash', 'beat saber', 'adofai',
  'rhythm doctor', 'dance dance revolution',
];

/** Game titles that are not ordinary words. Deliberately missing because
 *  they are: portal, halo, celeste, hades, persona, journey, doom, bleach,
 *  one piece. */
export const GAME_TITLES: readonly string[] = [
  'ultrakill', 'undertale', 'deltarune', 'minecraft', 'terraria', 'hollow knight', 'silksong',
  'genshin impact', 'honkai', 'zenless zone zero', 'blue archive', 'arknights', 'final fantasy',
  'kingdom hearts', 'nier', 'xenoblade', 'pokemon', 'legend of zelda', 'super mario', 'splatoon',
  'metroid', 'fire emblem', 'animal crossing', 'smash bros', 'sonic the hedgehog', 'mega man',
  'castlevania', 'chrono trigger', 'earthbound', 'elden ring', 'dark souls', 'bloodborne',
  'metal gear', 'doom eternal', 'cuphead', 'hotline miami', 'katana zero', 'omori', 'stardew valley',
  'cyberpunk 2077', 'league of legends', 'valorant', 'five nights at freddy', 'fnaf', 'pizza tower',
  'lethal company', 'team fortress', 'half life', 'risk of rain', 'outer wilds', 'guilty gear',
  'blazblue', 'devil may cry', 'danganronpa', 'ace attorney',
];

/** The scenes themselves. */
export const SCENE_WORDS: readonly string[] = [
  'touhou', 'vocaloid', 'utau', 'utaite', 'hatsune miku', 'kasane teto', 'kagamine', 'megurine luka',
  'synthesizer v', 'doujin', 'anime', 'anison', 'anisong', 'vgm',
];

/** The same in Japanese, matched as substrings (no word gaps there). */
export const SCENE_WORDS_CJK: readonly string[] = [
  '東方', 'ボカロ', '初音ミク', '重音テト', 'アニメ', '音ゲー', '歌ってみた', 'プロセカ', 'ゲーム音楽',
];

/** Tag-only words: what Last.fm and MusicBrainz call the scene, too generic
 *  for a song title ("Game" is a song). Regex sources in folded form, read
 *  as whole words inside a longer tag. */
export const TAG_KEYWORDS: readonly string[] = [
  'video ?games?', 'games? (?:music|soundtracks?|ost)', 'j ?core', 'rhythm games?', 'chiptunes?',
  'chip music', '8 ?bit', 'seiyuu', 'visual novels?', 'denpa',
];

/** Tags that count only as the whole tag. */
export const TAG_EXACT: readonly string[] = ['game', 'games', 'jcore'];

/** Lowercase, accents gone (not the Japanese voicing marks), full-width
 *  folded, "-", "_" and "/" read as spaces. */
export function foldText(s: string): string {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');

/** One regex matching any of `parts` as whole words (letters and digits on
 *  neither side). `parts` are regex sources when `raw`, else plain words. */
export function wholeWords(parts: readonly string[], raw = false): RegExp {
  const body = parts.map((p) => (raw ? p : escape(p))).join('|');
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, 'u');
}

/** Any of the named games or scene words, as whole words. */
export const NAMED_RE = wholeWords([...RHYTHM_GAMES, ...GAME_TITLES, ...SCENE_WORDS]);

export function hasCjkSceneWord(folded: string): boolean {
  return SCENE_WORDS_CJK.some((w) => folded.includes(w));
}
