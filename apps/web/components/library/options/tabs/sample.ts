/** The score every /dizajn tab candidate draws: a short original riff (not
 *  anyone's song), for the mock's now-playing track. Drop D guitar with palm
 *  mutes, a hammer-on and a slide, and a bass line on the roots, at 96 bpm.
 *  Checked with alphaTab's own parser: eight full bars of 4/4 per track. */
export const SAMPLE_TEX = String.raw`\title "Copper Sky"
\artist "Coastline"
\tempo 96
\track ("Guitar" "Gtr")
\instrument 30
\tuning (E4 B3 G3 D3 A2 D2)
\ts (4 4)
(0.6{pm} 0.5{pm} 0.4{pm}).8 (0.6{pm} 0.5{pm} 0.4{pm}).8 0.6{pm}.16 0.6{pm}.16 (0.6 0.5 0.4).8 r.8 (3.6 3.5 3.4).8 (5.6 5.5 5.4).4 |
0.6{pm}.8 0.6{pm}.8 3.6.8 0.6{pm}.8 5.6.8 0.6{pm}.8 3.5{h}.8 5.5.8 |
(7.6 7.5 7.4).4 (5.6 5.5 5.4).8 (3.6 3.5 3.4).8 (0.6 0.5 0.4).4 r.4 |
5.3.16 7.3.16 5.3.8 7.4.8 5.4{sl}.8 7.4.8 7.3.4 r.8 |
(0.6{pm} 0.5{pm} 0.4{pm}).8 (0.6{pm} 0.5{pm} 0.4{pm}).8 0.6{pm}.16 0.6{pm}.16 (0.6 0.5 0.4).8 r.8 (3.6 3.5 3.4).8 (5.6 5.5 5.4).4 |
0.6{pm}.8 0.6{pm}.8 3.6.8 0.6{pm}.8 5.6.8 0.6{pm}.8 3.5{h}.8 5.5.8 |
(7.6 7.5 7.4).4 (8.6 8.5 8.4).8 (7.6 7.5 7.4).8 (5.6 5.5 5.4).4 (3.6 3.5 3.4).4 |
(0.6 0.5 0.4 0.3).2 r.2
\track ("Bass" "Bass")
\instrument 33
\tuning (G2 D2 A1 D1)
0.4.8 0.4.8 0.4.16 0.4.16 0.4.8 r.8 3.4.8 5.4.4 |
0.4.8 0.4.8 3.4.8 0.4.8 5.4.8 0.4.8 3.4.8 5.4.8 |
7.4.4 5.4.8 3.4.8 0.4.4 r.4 |
0.4.2 0.3.4 r.4 |
0.4.8 0.4.8 0.4.16 0.4.16 0.4.8 r.8 3.4.8 5.4.4 |
0.4.8 0.4.8 3.4.8 0.4.8 5.4.8 0.4.8 3.4.8 5.4.8 |
7.4.4 8.4.8 7.4.8 5.4.4 3.4.4 |
0.4.2 r.2
`;

export const SAMPLE_SONG = {
  title: 'Copper Sky',
  artist: 'Coastline',
  tempo: 96,
  key: 'D minor',
  bars: 8,
};

/** One entry per alphaTex track, in score order: what the track picker
 *  shows (instrument and tuning), so it needs no parsed score. */
export const SAMPLE_TRACKS = [
  { name: 'Guitar', instrument: 'Distortion guitar', tuning: 'Drop D', strings: 'D A D G B E' },
  { name: 'Bass', instrument: 'Bass', tuning: 'Drop D', strings: 'D A D G' },
] as const;
