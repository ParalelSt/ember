import { describe, expect, it } from 'vitest';
import { songSignal, type SongSignal } from './songSignal';

// The title signal on a table of real-looking titles: the reported songs,
// the scene's usual words, and the look-alikes that must stay null.

const s = (title: string, artist = 'Someone', album: string | null = null) => songSignal({ title, artist, album });

const CASES: [string, string, string | null, SongSignal][] = [
  // strong
  ['Tenebre Rosso Sangue (ULTRAKILL Soundtrack)', 'KEYGEN CHURCH', null, 'strong'],
  ['Megalovania (Undertale OST)', 'Toby Fox', null, 'strong'],
  ['[BOF:NT] Some Song', 'Some Composer', null, 'strong'],
  ['[BOFU2016] Entry', 'Some Composer', null, 'strong'],
  ['Rolling Girl feat. 初音ミク', 'wowaka', null, 'strong'],
  ['Bad Apple!! (Touhou)', 'Alstroemeria Records', null, 'strong'],
  ['Freedom Dive (osu! version)', 'xi', null, 'strong'],
  ['Grievous Lady', 'Team Grimoire', 'Arcaea Sound Collection', 'strong'],
  ['115', 'Elena Siegman', 'Call of Duty: Black Ops - Zombies (Original Game Soundtrack)', 'strong'],
  ['Pokémon Theme', 'Jason Paige', null, 'strong'],
  ['Song (Video Game Version)', 'X', null, 'strong'],
  ['Enemy (from the series Arcane League of Legends)', 'Imagine Dragons', null, 'strong'],
  ['Hollow Knight - City of Tears', 'Christopher Larkin', null, 'strong'],
  ['Half-Life 2 Theme', 'Kelly Bailey', null, 'strong'],
  // weak
  ['Main Theme (Original Soundtrack)', 'Someone', null, 'weak'],
  ['Boss Theme', 'Someone', null, 'weak'],
  ['Track 01', 'XYZ OST', null, 'weak'],
  ['Stage 1 BGM', 'Someone', null, 'weak'],
  ['Level 3 (8-bit)', 'Someone', null, 'weak'],
  // null: films, stage and plain pop
  ['Main Theme (Original Motion Picture Soundtrack)', 'Someone', null, null],
  ['Theme (from the film Dune)', 'Hans Zimmer', 'Dune (Original Soundtrack)', null],
  ['Defying Gravity (Original Broadway Cast Recording)', 'Idina Menzel', null, null],
  ['Houdini', 'Dua Lipa', 'Radical Optimism', null],
  ['Doom', 'Some Metal Band', null, null],
  ['Halo', 'Beyonce', null, null],
  ['Portal', 'Someone', null, null],
  ['One Piece at a Time', 'Johnny Cash', null, null],
  ['Pump It Up', 'Danzel', null, null],
  ['Ghost (Official Video)', 'Justin Bieber', null, null],
  ['Game Over', 'Someone', null, null],
  ['Animal', 'Neon Trees', null, null],
  ['Costume (Official Video)', 'Someone', null, null],
  // the other reported songs: the title rule does not catch them (the radio rule does)
  ['Blast Out From Symphony', 'UmβRizZ', null, null],
  ["Maiden's Capriccio", 'MrRevendread210', null, null],
  ['Heart of Corruption', 'Lappy', null, null],
  ['Evil intention', 'Noah', null, null],
];

describe('songSignal', () => {
  it.each(CASES)('%s by %s (%s) is %s', (title, artist, album, want) => {
    expect(s(title, artist, album)).toBe(want);
  });

  it('reads strong words only in the title and album, weak ones in the uploader name too', () => {
    expect(s('Track 7', 'Undertale Fan Channel')).toBeNull();
    expect(s('Track 7', 'Some Game OST')).toBe('weak');
  });

  it('does not join the title and the album into one phrase', () => {
    expect(s('My Video', 'X', 'Game Night')).toBeNull();
  });
});
