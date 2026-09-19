/** Builds the Songsterr fixtures in this folder:
 *
 *      node tests/fixtures/songsterr/build.mjs
 *
 *  The SHAPE is Songsterr's as a browser got it on 2026-09-19: the search
 *  API's JSON (`/api/songs?pattern=`), a song page with its state as plain
 *  JSON in `<script id="state" type="application/json">` (`meta.current`:
 *  songId, revisionId, image, tracks with partId, isGuitar, isBassGuitar,
 *  isDrums, isVocalTrack, views, tuning high string first), and the part
 *  files from the CDN (`<songId>/<revisionId>/<image>/<partId>.json`:
 *  measures, voices, beats with `duration` [n, d] and `type`, `dots`,
 *  `tuplet`, notes with `string` 0 = top line, `fret`, `tie`, `dead`,
 *  `ghost`, `slide`, `bend`, `staccato`; `signature` and `marker` on a
 *  measure; `automations.tempo`). EVERY title, artist, name and note here is
 *  invented for Ember's tests: "Night Ferry" and "Copper Tide" do not exist,
 *  and no real tab is stored.
 *
 *  Files:
 *    search.json          a search: the song, its "(Acoustic)" variant and
 *                         another band's song of a similar name
 *    song.html            the song page, state JSON inside
 *    part-<n>.json        parts 0 (vocals), 1 (lead), 2 (rhythm, most
 *                         viewed), 3 (bass, Drop D), 4 (drums)
 *
 *  The song, as played (repeats written out): a pickup bar, a verse of four
 *  bars played twice, a 3/4 bar, a chorus (tempo 100 to 110) with first and
 *  second endings, an outro bar that slows to 96 halfway, a last bar. 18
 *  bars. `timeline()` below gives every note's time on the tab's clock, for
 *  the browser test that plays a recording of it. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(import.meta.url);
const DIR = path.dirname(HERE);

export const ARTIST = 'Night Ferry';
export const SONG = 'Copper Tide';
export const SONG_ID = 777001;
export const REVISION_ID = 5550001;
export const IMAGE = 'v0-fixture-Ab12Cd34';

const STANDARD = [64, 59, 55, 50, 45, 40];
const DROP_D = [64, 59, 55, 50, 45, 38];
const BASS_DROP_D = [43, 38, 33, 26];

// ── a small language for beats ─────────────────────────────────────────────
// "8:0/3,0/4,0/5" = an eighth, frets 0 on strings 3, 4 and 5 (0 = top line)
// "4r" = a quarter rest; effects after the fret: x dead, g ghost, t tie,
// s shift slide, b bend, h hammer, v vibrato, . staccato; beat suffixes:
// "d" dotted, "t3" triplet.
const VALUE = { 1: [1, 1], 2: [1, 2], 4: [1, 4], 8: [1, 8], 16: [1, 16] };

function beat(spec) {
  const m = /^(\d+)(d?)(?:t(\d))?(r?)(?::(.*))?$/.exec(spec);
  if (!m) throw new Error(`bad beat ${spec}`);
  const type = Number(m[1]);
  const dots = m[2] ? 1 : 0;
  const tuplet = m[3] ? Number(m[3]) : 0;
  let [n, d] = VALUE[type];
  if (dots) [n, d] = [n * 3, d * 2];
  if (tuplet === 3) [n, d] = [n * 2, d * 3];
  const g = (a, b) => (b ? g(b, a % b) : a);
  const k = g(n, d);
  const b = { notes: [], type, duration: [n / k, d / k] };
  if (dots) b.dots = 1;
  if (tuplet) b.tuplet = tuplet;
  if (m[4]) {
    b.rest = true;
    b.notes = [{ rest: true }];
    return b;
  }
  for (const part of m[5].split(',')) {
    const nm = /^(\d+)\/(\d)([xgtsbhv.]*)$/.exec(part);
    if (!nm) throw new Error(`bad note ${part}`);
    const note = { fret: Number(nm[1]), string: Number(nm[2]) };
    for (const fx of nm[3]) {
      if (fx === 'x') note.dead = true;
      if (fx === 'g') note.ghost = true;
      if (fx === 't') note.tie = true;
      if (fx === 's') note.slide = 'shift';
      if (fx === 'h') note.hp = true;
      if (fx === 'v') note.leftHandVibrato = 'slight';
      if (fx === '.') note.staccato = true;
      if (fx === 'b') {
        note.bend = { tone: 50, points: [{ tone: 0, position: 0 }, { tone: 50, position: 20 }, { tone: 50, position: 60 }] };
      }
    }
    b.notes.push(note);
  }
  return b;
}

const bar = (...specs) => ({ voices: [{ beats: specs.map(beat) }] });
const restBar = () => ({ voices: [{ beats: [{ notes: [{ rest: true }], type: 1, rest: true, duration: [1, 1] }], rest: true }], rest: true });
const eights = (chord, n = 8) => Array.from({ length: n }, () => `8:${chord}`);

// The song's structure, shared by every part (Songsterr repeats it in each).
const STRUCTURE = [
  { signature: [4, 4], marker: { text: 'Intro', width: 30 } }, // 0 pickup
  { repeatStart: true, marker: { text: 'Verse', width: 30 } }, // 1
  {}, // 2
  {}, // 3
  { repeatClose: true, repeat: 2 }, // 4
  { signature: [3, 4] }, // 5
  { signature: [4, 4], repeatStart: true, marker: { text: 'Chorus', width: 40 } }, // 6
  {}, // 7
  { alternateEnding: [1], repeatClose: true, repeat: 2 }, // 8
  { alternateEnding: [2] }, // 9
  { marker: { text: 'Outro', width: 30 } }, // 10
  {}, // 11
];

// Rhythm guitar, Drop D power chords in straight eighths (the most viewed
// track, so it is drawn first).
const D5 = '0/3,0/4,0/5';
const F5 = '3/3,3/4,3/5';
const G5 = '5/3,5/4,5/5';
const C5 = '10/3,10/4,10/5';
const A5 = '7/3,7/4,7/5';
const RHYTHM = [
  bar(`8:${D5}`, `8:${D5}`),
  bar(...eights(D5, 6), `8:${F5}`, `8:${F5}`),
  bar(...eights(G5)),
  bar(...eights(D5, 4), ...eights(C5, 4)),
  bar(...eights(A5)),
  bar(...eights(G5, 6)),
  bar(...eights(D5)),
  bar(...eights(F5, 4), ...eights(G5, 4)),
  bar(...eights(C5)),
  bar(...eights(A5)),
  bar(...eights(D5)),
  bar(`1:${D5}`),
];

// Lead guitar, standard tuning: dotted rhythms, a tie, slides, a bend, a
// hammer-on, triplets, dead and ghost notes, sixteenths.
const LEAD = [
  bar('4r'),
  bar('4d:12/1', '8:10/1', '4:12/1h', '4:14/1s'),
  bar('2:15/1v', '4:15/1t', '4r'),
  bar('8:12/2', '8:12/2x', '8:14/2', '8:15/2', '4:14/2b', '4r'),
  bar('1:12/1v'),
  bar('4t3:10/2', '4t3:12/2', '4t3:13/2', '2:12/2'),
  bar('2:17/0', '2:15/0'),
  bar('4:14/0', '4:15/0', '2:17/0v'),
  bar('1:19/0b'),
  bar('2:17/0', '4:15/0g', '4:14/0'),
  bar('16:12/1', '16:13/1', '16:15/1', '16:13/1', '8:12/1', '8:10/2x', '2:12/1'),
  bar('2:10/1', '2:10/1t'),
];

// Bass, Drop D four-string: roots in eighths and quarters.
const BASS = [
  bar('8:0/3', '8:0/3'),
  bar('4:0/3', '4:0/3', '4:0/3', '4:3/3'),
  bar('4:5/3', '4:5/3', '4:5/3', '4:5/3'),
  bar('4:0/3', '4:0/3', '4:10/3', '4:10/3'),
  bar('2:7/3', '2:7/3'),
  bar('4:5/3', '4:5/3', '4:5/3'),
  bar(...Array.from({ length: 8 }, () => '8:0/3')),
  bar('2:3/3', '2:5/3'),
  bar('1:10/3'),
  bar('1:7/3'),
  bar('4:0/3', '4:0/3', '4:0/3', '4:0/3'),
  bar('1:0/3'),
];

const DRUMS = STRUCTURE.map((_, i) => (i === 0 ? bar('8:36/0', '8:38/0') : bar(...Array.from({ length: 8 }, () => '8:42/0'))));
const VOCALS = STRUCTURE.map(() => restBar());

/** Tempo: 100 bpm, 110 from the chorus, 96 from the middle of the outro.
 *  `position` counts the beats of the part's own first voice: 4 is the
 *  fifth eighth of the rhythm part, halfway through the bar. */
const TEMPO = [
  { measure: 0, position: 0, bpm: 100, type: 4 },
  { measure: 6, position: 0, bpm: 110, type: 4 },
  { measure: 10, position: 4, bpm: 96, type: 4 },
];

function part(partId, name, instrument, instrumentId, tuning, measures) {
  return {
    name,
    balance: 0,
    volume: 1,
    measures: measures.map((m, i) => ({ ...STRUCTURE[i], ...m })),
    frets: 24,
    tuning,
    strings: tuning.length,
    instrumentId,
    instrument,
    newLyrics: [],
    partId,
    automations: { tempo: TEMPO },
    version: 3,
    songId: SONG_ID,
    revisionId: REVISION_ID,
  };
}

export const TRACKS = [
  { partId: 0, instrumentId: 54, instrument: 'Voice Oohs', views: 120, name: 'Lead Vocals | Ada North', tuning: STANDARD, isVocalTrack: true, isDrums: false, isBassGuitar: false, isGuitar: false, hash: 'vocals_Fx01' },
  { partId: 1, instrumentId: 30, instrument: 'Distortion Guitar', views: 900, name: 'Mara Quill | Lead Guitar', tuning: STANDARD, difficulty: 3, isVocalTrack: false, isDrums: false, isBassGuitar: false, isGuitar: true, hash: 'guitar_Fx02' },
  { partId: 2, instrumentId: 30, instrument: 'Distortion Guitar', views: 5000, name: 'Tomas Reed | Firewood Custom | Rhythm Guitar', tuning: DROP_D, difficulty: 2, isVocalTrack: false, isDrums: false, isBassGuitar: false, isGuitar: true, hash: 'guitar_Fx03' },
  { partId: 3, instrumentId: 34, instrument: 'Electric Bass (pick)', views: 2000, name: 'Ines Vale | Bass', tuning: BASS_DROP_D, difficulty: 2, isVocalTrack: false, isDrums: false, isBassGuitar: true, isGuitar: false, hash: 'other_Fx04' },
  { partId: 4, instrumentId: 1024, instrument: 'Drums', views: 700, name: 'Drums', isVocalTrack: false, isDrums: true, isBassGuitar: false, isGuitar: false, difficulty: 2, hash: 'drums_Fx05' },
];

export const PARTS = {
  0: part(0, TRACKS[0].name, TRACKS[0].instrument, 54, STANDARD, VOCALS),
  1: part(1, TRACKS[1].name, TRACKS[1].instrument, 30, STANDARD, LEAD),
  2: part(2, TRACKS[2].name, TRACKS[2].instrument, 30, DROP_D, RHYTHM),
  3: part(3, TRACKS[3].name, TRACKS[3].instrument, 34, BASS_DROP_D, BASS),
  4: part(4, TRACKS[4].name, TRACKS[4].instrument, 1024, [], DRUMS),
};

/** One search result, Songsterr's shape. */
function result(songId, artist, title, tracks) {
  return {
    songId,
    artistId: 9001,
    artist,
    title,
    hasChords: true,
    hasPlayer: true,
    tracks: tracks.map(({ partId, isVocalTrack, isDrums, isBassGuitar, isGuitar, ...t }) => t),
    defaultTrack: 2,
    popularTrack: 2,
    isJunk: false,
    popularTrackGuitar: 2,
    popularTrackBass: 3,
    popularTrackDrum: 4,
    popularTrackVocals: 0,
  };
}

export function search() {
  return [
    result(SONG_ID, ARTIST, SONG, TRACKS),
    result(SONG_ID + 1, ARTIST, `${SONG} (Acoustic)`, TRACKS.slice(1, 2)),
    result(SONG_ID + 2, 'Harbour Choir', `${SONG} Blues`, TRACKS.slice(1, 3)),
  ];
}

export function state() {
  return {
    runningThunks: {},
    network: { online: true },
    route: { page: 'tab', params: { songId: SONG_ID, partId: null, partIds: [], revisionId: null, notationMode: 'tab' } },
    meta: {
      current: {
        aiGenerated: false,
        fingerstyle: false,
        createdAt: '2026-09-01T10:00:00.000Z',
        revisionId: REVISION_ID,
        songId: SONG_ID,
        artist: ARTIST,
        artistId: 9001,
        title: SONG,
        author: { personId: 1, name: 'fixture', profileName: 'fixture', isModerator: false },
        description: 'fixture',
        restriction: '',
        hasPlayer: true,
        hasTracks: true,
        hasChords: true,
        tracks: TRACKS.map((t) => ({
          ...t,
          isEmpty: false,
          title: `${t.name} - ${t.instrument}`,
          isPiano: false,
          originalPartId: t.partId,
        })),
        defaultTrack: 2,
        popularTrack: 2,
        isPublished: true,
        isBlank: false,
        isPopular: false,
        isJunk: false,
        videos: [],
        tags: [],
        views: 1234,
        image: IMAGE,
        isBlocked: false,
        isRestricted: false,
        partId: 2,
      },
    },
    part: { current: null, songId: SONG_ID, partId: 2, revisionId: REVISION_ID },
    user: { profile: null },
    hash: '',
  };
}

export function songPage(st = state()) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${st.meta.current.artist} - ${st.meta.current.title} Tab | Songsterr Tabs with Rhythm</title>
<link rel="preconnect" href="https://dqsljvtekg760.cloudfront.net/"></head>
<body><div id="apptab"></div>
<script id="state" type="application/json">${JSON.stringify(st)}</script>
</body></html>
`;
}

// ── the tab's clock ────────────────────────────────────────────────────────

/** The played order of the measures (repeats and endings written out). */
export const PLAYED = [0, 1, 2, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8, 6, 7, 9, 10, 11];

const frac = ([n, d]) => n / d;

/** Every onset on the tab's clock, seconds from the top of the tab, with
 *  its MIDI pitches (dead notes have none), across the drawn parts (lead,
 *  rhythm, bass); and where each played bar starts. The pickup bar lasts
 *  its content (a quarter). Tempo in quarter notes per minute. */
export function timeline() {
  const bpmAt = (measure, position) => {
    let bpm = TEMPO[0].bpm;
    for (const t of TEMPO) if (t.measure < measure || (t.measure === measure && t.position <= position)) bpm = t.bpm;
    return bpm;
  };
  const drawn = [PARTS[1], PARTS[2], PARTS[3]];
  const bars = [];
  const onsets = new Map();
  let clock = 0;
  PLAYED.forEach((mi, k) => {
    bars.push({ bar: k, sec: clock });
    const sig = PARTS[2].measures.slice(0, mi + 1).reduce((s, m) => m.signature ?? s, [4, 4]);
    // Tempo changes inside the bar sit on the rhythm part's beats (the part
    // drawn first, whose automations Ember reads).
    const rhythm = PARTS[2].measures[mi].voices[0].beats;
    const tempoPoints = [];
    let w = 0;
    rhythm.forEach((b, i) => {
      tempoPoints.push({ at: w, bpm: bpmAt(mi, i) });
      w += frac(b.duration);
    });
    const barWhole = k === 0 ? 0.25 : sig[0] / sig[1];
    const toSec = (whole) => {
      // Seconds from the bar's start to `whole` into it.
      let sec = 0;
      let from = 0;
      let bpm = tempoPoints[0]?.bpm ?? bpmAt(mi, 0);
      for (const p of tempoPoints) {
        if (p.at >= whole) break;
        sec += (p.at - from) * 4 * (60 / bpm);
        from = p.at;
        bpm = p.bpm;
      }
      return sec + (whole - from) * 4 * (60 / bpm);
    };
    for (const p of drawn) {
      let at = 0;
      for (const b of p.measures[mi].voices[0].beats) {
        const sounding = (b.notes ?? []).filter((n) => !n.rest && !n.tie);
        if (!b.rest && sounding.length) {
          const t = Math.round((clock + toSec(at)) * 1e6) / 1e6;
          const e = onsets.get(t) ?? [];
          for (const n of sounding) if (!n.dead) e.push(p.tuning[n.string] + n.fret);
          onsets.set(t, e);
        }
        at += frac(b.duration);
      }
    }
    clock += toSec(barWhole);
  });
  return {
    bars,
    end: clock,
    onsets: [...onsets.entries()].sort((a, b) => a[0] - b[0]).map(([sec, pitches]) => ({ sec, pitches })),
  };
}

if (process.argv[1] === HERE) {
  fs.writeFileSync(path.join(DIR, 'search.json'), `${JSON.stringify(search(), null, 1)}\n`);
  fs.writeFileSync(path.join(DIR, 'song.html'), songPage());
  for (const [id, p] of Object.entries(PARTS)) fs.writeFileSync(path.join(DIR, `part-${id}.json`), `${JSON.stringify(p)}\n`);
  console.log(`wrote ${2 + Object.keys(PARTS).length} fixtures to ${path.relative(process.cwd(), DIR) || '.'}`);
}
