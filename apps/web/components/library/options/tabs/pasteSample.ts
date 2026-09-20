/** The text tab the /dizajn paste candidates start with: an original riff
 *  for the mock's "Copper Sky" by Coastline (nobody's real song), typed the
 *  way tabs look on Ultimate Guitar: a header, Drop D labels, a palm-mute
 *  line, "x2", sections, hammer-ons, a slide, a bend and vibrato, and the
 *  chord and lyric lines people paste along with the tab. The previews run
 *  it through the real parser (lib/tabText.ts). */
export const PASTE_SAMPLE_TEXT = String.raw`Copper Sky - Coastline
Tabbed by Aron
Tuning: Drop D (D A D G B E)
Tempo: 96

[Intro]
   PM-----
e|-----------------|-----------------|
B|-----------------|-----------------|
G|-----------------|-----------------|
D|-0-0-0-0-3---5---|-0-0-3-0-5-0-----|
A|-0-0-0-0-3---5---|-0-0-3-0-5-0-----|
D|-0-0-0-0-3---5---|-0-0-3-0-5-0-----|
x2

[Verse]
e|-----------------|-----------------|
B|-----------------|-----------------|
G|-----------------|---------5-7-7~--|
D|-7---5---3---0---|-5h7-5/7---------|
A|-7---5---3---0---|-----------------|
D|-7---5---3---0---|-----------------|

G5              F5
Salt on the copper, the sky coming down

[Chorus]
e|-3-------3-------|-2-------0-------|-----------------|
B|-3-------3-------|-3-------1-------|-8b10----8---7~~-|
G|-4-------4-------|-2-------2-------|-----------------|
D|-5-------5-------|-0-------2-------|-----------------|
A|-5-------5-------|-----------------|-----------------|
D|-3-------3-------|-----------------|-----------------|
`;

/** The mock song the paste is for. 9 bars at 96 bpm last 22.5 s, so "Fit to
 *  song length" lands on the tab's own tempo. */
export const PASTE_SAMPLE_SONG = {
  title: 'Copper Sky',
  artist: 'Coastline',
  durationSec: 22.5,
};
