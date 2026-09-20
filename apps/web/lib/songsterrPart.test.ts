// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import {
  chooseSongsterrTracks,
  midiName,
  parseSongsterrPage,
  partUrl,
  playOrder,
  readSongsterrPart,
  readSongsterrState,
  songsterrPageUrl,
  songsterrToAlphaTex,
  trackLabel,
  type SongsterrBeat,
  type SongsterrInputTrack,
  type SongsterrMeasure,
  type SongsterrPart,
  type SongsterrResult,
} from './songsterrPart';
import { planFromAlphaTex } from './tabPlan';

/** tests/fixtures/songsterr: Songsterr's shapes, invented content
 *  (tests/fixtures/songsterr/build.mjs). Every alphaTex this writes is read
 *  back by the installed AlphaTab, and the checks read the score it builds. */
const FIXTURES = path.resolve(__dirname, '../../../tests/fixtures/songsterr');
const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const part = (id: number) => readSongsterrPart(JSON.parse(fixture(`part-${id}.json`)))!;
const META = { title: 'Copper Tide', artist: 'Night Ferry' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Score = any;

/** AlphaTab's own reading of the alphaTex. Throws on anything it rejects. */
function importTex(tex: string): Score {
  const imp = new alphaTab.importer.AlphaTexImporter();
  imp.initFromString(tex, new alphaTab.Settings());
  return imp.readScore();
}

function ok(r: SongsterrResult) {
  if (!r.ok) throw new Error(r.error);
  return r;
}

function fixtureInput(): SongsterrInputTrack[] {
  const page = parseSongsterrPage(fixture('song.html'))!;
  return chooseSongsterrTracks(page.tracks).map((track) => ({ track, part: part(track.partId) }));
}

/** A one-part song from measures, standard tuning, 120 bpm unless given. */
function song(measures: SongsterrMeasure[], extra: Partial<SongsterrPart> = {}, tuning = [64, 59, 55, 50, 45, 40]): SongsterrInputTrack[] {
  return [
    {
      track: { name: 'Test | Guitar', instrument: 'Distortion Guitar', instrumentId: 30, tuning, isBass: false },
      part: { tuning, measures, automations: { tempo: [{ measure: 0, position: 0, bpm: 120, type: 4 }] }, ...extra },
    },
  ];
}
const b = (type: number, notes: SongsterrBeat['notes'], more: Partial<SongsterrBeat> = {}): SongsterrBeat => ({
  type,
  duration: [1, type],
  notes,
  ...more,
});
const m = (beats: SongsterrBeat[], more: Partial<SongsterrMeasure> = {}): SongsterrMeasure => ({ voices: [{ beats }], ...more });

describe('the song page', () => {
  it('reads songId, revision, image and every track from the state JSON', () => {
    const page = parseSongsterrPage(fixture('song.html'))!;
    expect(page).toMatchObject({ songId: 777001, revisionId: 5550001, image: 'v0-fixture-Ab12Cd34', title: 'Copper Tide', artist: 'Night Ferry', restricted: false });
    expect(page.tracks.map((t) => [t.partId, t.isGuitar, t.isBass, t.isDrums, t.isVocal])).toEqual([
      [0, false, false, false, true],
      [1, true, false, false, false],
      [2, true, false, false, false],
      [3, false, true, false, false],
      [4, false, false, true, false],
    ]);
    expect(page.tracks[3].tuning).toEqual([43, 38, 33, 26]);
  });

  it('sees a restricted or blocked tab, and refuses what is not a tab page', () => {
    const st = readSongsterrState(fixture('song.html'))!;
    const cur = (st.meta as { current: Record<string, unknown> }).current;
    const wrap = (s: unknown) => `<script id="state" type="application/json">${JSON.stringify(s)}</script>`;
    expect(parseSongsterrPage(wrap({ meta: { current: { ...cur, isRestricted: true } } }))!.restricted).toBe(true);
    expect(parseSongsterrPage(wrap({ meta: { current: { ...cur, restriction: 'licensed' } } }))!.restricted).toBe(true);
    expect(parseSongsterrPage(wrap({ meta: { current: { ...cur, image: '../x' } } }))).toBeNull();
    expect(parseSongsterrPage('<html>captcha</html>')).toBeNull();
    expect(parseSongsterrPage('<script id="state" type="application/json">{not json</script>')).toBeNull();
  });

  it('chooses the guitars (most played first) and the bass, never vocals or drums', () => {
    const page = parseSongsterrPage(fixture('song.html'))!;
    expect(chooseSongsterrTracks(page.tracks).map((t) => t.partId)).toEqual([2, 1, 3]);
    expect(chooseSongsterrTracks(page.tracks, 2).map((t) => t.partId)).toEqual([2, 3]);
    expect(chooseSongsterrTracks(page.tracks.map((t) => ({ ...t, isEmpty: t.partId === 2 }))).map((t) => t.partId)).toEqual([1, 3]);
  });

  it('builds the CDN and page URLs', () => {
    const page = parseSongsterrPage(fixture('song.html'))!;
    expect(partUrl('https://dqsljvtekg760.cloudfront.net/', page, 3)).toBe(
      'https://dqsljvtekg760.cloudfront.net/777001/5550001/v0-fixture-Ab12Cd34/3.json',
    );
    expect(songsterrPageUrl('https://www.songsterr.com', { songId: 466, artist: 'Beyoncé & Co', title: 'Hello, World!' })).toBe(
      'https://www.songsterr.com/a/wsa/beyonce-co-hello-world-tab-s466',
    );
  });

  it('names a track by what it plays', () => {
    expect(trackLabel({ name: 'Barry Stock | Ibanez Iceman | Lead Guitar', instrument: 'Distortion Guitar', isBass: false })).toBe('Lead Guitar');
    expect(trackLabel({ name: 'Brad Walst | Music Man Stingray | Bass', instrument: 'Electric Bass (pick)', isBass: true })).toBe('Bass');
    expect(trackLabel({ name: '', instrument: 'Distortion Guitar', isBass: false })).toBe('Distortion Guitar');
    expect(midiName(26)).toBe('D1');
    expect(midiName(61)).toBe('C#4');
  });
});

describe('play order', () => {
  it('writes repeats and first and second endings out', () => {
    const structure = JSON.parse(fixture('part-2.json')).measures as SongsterrMeasure[];
    expect(playOrder(structure)).toEqual({ order: [0, 1, 2, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8, 6, 7, 9, 10, 11], repeats: 2 });
  });

  it('repeats three times, from the top when no start is marked', () => {
    expect(playOrder([{}, { repeat: 3 }, {}]).order).toEqual([0, 1, 0, 1, 0, 1, 2]);
    expect(playOrder([{}, { repeatClose: true }]).order).toEqual([0, 1, 0, 1]);
  });

  it('never loops forever on a malformed song', () => {
    const r = playOrder([{ repeatStart: true, repeat: 1e6 }]);
    expect(r.order.length).toBeLessThanOrEqual(2000);
  });
});

describe('the fixture song, converted', () => {
  const r = ok(songsterrToAlphaTex(fixtureInput(), META));
  const score = importTex(r.alphaTex);
  const staff = (t: number) => score.tracks[t].staves[0];

  it('is one file with a staff per chosen track, named, tuned and voiced', () => {
    expect(score.tracks.map((t: Score) => t.name)).toEqual(['Rhythm Guitar', 'Lead Guitar', 'Bass']);
    expect(staff(0).tuning).toEqual([64, 59, 55, 50, 45, 38]);
    expect(staff(1).tuning).toEqual([64, 59, 55, 50, 45, 40]);
    expect(staff(2).tuning).toEqual([43, 38, 33, 26]);
    expect(score.tracks.map((t: Score) => t.playbackInfo.program)).toEqual([30, 30, 34]);
    expect(r.report.tracks.map((t) => [t.label, t.tuning])).toEqual([
      ['Rhythm Guitar', 'D A D G B E'],
      ['Lead Guitar', 'E A D G B E'],
      ['Bass', 'D A D G'],
    ]);
  });

  it('has 18 bars as played: a pickup, repeats and endings written out', () => {
    expect(score.masterBars.length).toBe(18);
    expect(r.report).toMatchObject({ bars: 18, measures: 12, anacrusis: true, repeatsWrittenOut: 2 });
    expect(score.masterBars[0].isAnacrusis).toBe(true);
    expect(score.masterBars[0].calculateDuration()).toBe(960);
    expect(score.masterBars[1].isAnacrusis).toBe(false);
    expect(score.masterBars.map((mb: Score) => mb.section?.text ?? '').filter(Boolean)).toEqual(['Intro', 'Verse', 'Verse', 'Chorus', 'Chorus', 'Outro']);
  });

  it('changes time signature: 3/4 for one bar, back to 4/4', () => {
    const sigs = score.masterBars.map((mb: Score) => `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`);
    expect(sigs[9]).toBe('3/4');
    expect(sigs.filter((s: string) => s !== '4/4')).toEqual(['3/4']);
    expect(r.report.signatureChanges).toBe(2);
  });

  it('changes tempo at the chorus and halfway through the outro', () => {
    const autos = score.masterBars.map((mb: Score) => mb.tempoAutomations.map((a: Score) => [a.value, a.ratioPosition]));
    expect(autos[0]).toEqual([[100, 0]]);
    expect(autos[10]).toEqual([[110, 0]]);
    expect(autos[16]).toEqual([[96, 0.5]]);
    expect(r.report.tempo).toBe(100);
    expect(r.report.tempoChanges).toBe(2);
  });

  it('keeps durations: dotted, triplets, sixteenths, ties, rests', () => {
    const lead = staff(1).bars;
    // Bar 1 (the verse): dotted quarter, eighth, quarter, quarter.
    expect(lead[1].voices[0].beats.map((x: Score) => [x.playbackStart, x.playbackDuration, x.dots])).toEqual([
      [0, 1440, 1],
      [1440, 480, 0],
      [1920, 960, 0],
      [2880, 960, 0],
    ]);
    // Bar 9 (the 3/4 bar): a quarter-note triplet, then a half.
    expect(lead[9].voices[0].beats.map((x: Score) => [x.playbackStart, x.tupletNumerator])).toEqual([
      [0, 3],
      [640, 3],
      [1280, 3],
      [1920, -1],
    ]);
    // Bar 2: the held note is a tie, then a quarter rest.
    const bar2 = lead[2].voices[0].beats;
    expect(bar2[1].notes[0].isTieDestination).toBe(true);
    expect(bar2[2].isRest).toBe(true);
    expect(lead[16].voices[0].beats.slice(0, 4).map((x: Score) => x.playbackDuration)).toEqual([240, 240, 240, 240]);
    expect(r.report.dotted).toBe(2);
    expect(r.report.tuplets).toBe(3);
    expect(r.report.durationFixes).toBe(0);
  });

  it('keeps dead and ghost notes and the effects it knows', () => {
    const notes = staff(1).bars.flatMap((bar: Score) => bar.voices[0].beats.flatMap((x: Score) => x.notes));
    expect(notes.filter((n: Score) => n.isDead).length).toBe(3); // bar 3 twice (played twice), bar 16
    expect(notes.filter((n: Score) => n.isGhost).length).toBe(1);
    expect(notes.some((n: Score) => n.hasBend)).toBe(true);
    expect(notes.some((n: Score) => n.isHammerPullOrigin)).toBe(true);
    expect(notes.some((n: Score) => n.slideOutType > 0)).toBe(true);
    expect(notes.some((n: Score) => n.vibrato > 0)).toBe(true);
    // Lead string 0 (the top line) is alphaTex string 1 = AlphaTab's string 6.
    expect(staff(1).bars[10].voices[0].beats[0].notes[0].realValue).toBe(64 + 17);
    // Drop D bass, open D on Songsterr's string 3 = the lowest.
    expect(staff(2).bars[1].voices[0].beats[0].notes[0].realValue).toBe(26);
  });

  it('plans the exact clock the fixture was written for: every bar and every note', async () => {
    const { timeline } = await import('../../../tests/fixtures/songsterr/build.mjs');
    const want = timeline();
    const plan = planFromAlphaTex(alphaTab, r.alphaTex);
    expect(plan.bars.length).toBe(want.bars.length);
    plan.bars.forEach((bar, i) => expect(Math.abs(bar.ms - want.bars[i].sec * 1000)).toBeLessThan(1));
    expect(Math.abs(plan.endMs - want.end * 1000)).toBeLessThan(1);
    expect(plan.notes.length).toBe(want.onsets.length);
    plan.notes.forEach((n, i) => {
      expect(Math.abs(n.ms - want.onsets[i].sec * 1000)).toBeLessThan(1);
      expect(n.p).toEqual([...want.onsets[i].pitches].sort((a: number, z: number) => a - z));
    });
    expect(plan.tempo).toBe(100);
  });
});

describe('conversion details', () => {
  it('writes a beat from its duration when the note value disagrees', () => {
    const r = ok(songsterrToAlphaTex(song([m([b(4, [{ string: 0, fret: 1 }], { duration: [1, 8] }), { duration: [3, 8], notes: [{ string: 0, fret: 2 }] }, b(2, [{ rest: true }], { rest: true })])]), META));
    const beats = importTex(r.alphaTex).tracks[0].staves[0].bars[0].voices[0].beats;
    expect(beats.map((x: Score) => [x.playbackStart, x.playbackDuration])).toEqual([
      [0, 480],
      [480, 1440],
      [1920, 1920],
    ]);
    expect(r.report.durationFixes).toBe(2);
  });

  it('turns a length no note value has into rests of the same length', () => {
    const r = ok(songsterrToAlphaTex(song([m([{ duration: [5, 16], notes: [{ string: 0, fret: 3 }] }, b(4, [{ string: 0, fret: 1 }])])]), META));
    const beats = importTex(r.alphaTex).tracks[0].staves[0].bars[0].voices[0].beats;
    expect(beats.map((x: Score) => [x.isRest, x.playbackStart])).toEqual([
      [true, 0],
      [true, 960],
      [false, 1200],
    ]);
  });

  it('reads tempo counted in eighths and dotted quarters as quarter notes', () => {
    const r = ok(
      songsterrToAlphaTex(
        song([m([b(1, [{ string: 0, fret: 0 }])]), m([b(1, [{ string: 0, fret: 0 }])])], {
          automations: { tempo: [{ measure: 0, position: 0, bpm: 180, type: 8 }, { measure: 1, position: 0, bpm: 60, type: 2 }] },
        }),
        META,
      ),
    );
    const score = importTex(r.alphaTex);
    expect(score.masterBars.map((mb: Score) => mb.tempoAutomations[0]?.value)).toEqual([90, 120]);
  });

  it('fills a whole-bar rest to its signature (3/4), and a pickup keeps its own length', () => {
    const r = ok(
      songsterrToAlphaTex(
        song([
          m([b(4, [{ string: 5, fret: 3 }])], { signature: [3, 4] }),
          { voices: [{ beats: [{ type: 1, duration: [1, 1], rest: true, notes: [{ rest: true }] }], rest: true }], rest: true },
          m([b(2, [{ string: 5, fret: 3 }], { dots: 1, duration: [3, 4] })]),
        ]),
        META,
      ),
    );
    const score = importTex(r.alphaTex);
    expect(score.masterBars.map((mb: Score) => [mb.isAnacrusis, mb.calculateDuration()])).toEqual([
      [true, 960],
      [false, 2880],
      [false, 2880],
    ]);
    expect(score.tracks[0].staves[0].bars[1].voices[0].beats.every((x: Score) => x.isRest)).toBe(true);
  });

  it('draws a second voice and counts unknown effects', () => {
    const r = ok(
      songsterrToAlphaTex(
        song([
          {
            voices: [
              { beats: [b(2, [{ string: 0, fret: 5, pickScrape: 'down' }]), b(2, [{ string: 0, fret: 7 }], { tremoloPicking: 8 })] },
              { beats: [b(1, [{ string: 5, fret: 0 }])] },
            ],
          },
        ]),
        META,
      ),
    );
    const bar = importTex(r.alphaTex).tracks[0].staves[0].bars[0];
    expect(bar.voices.length).toBe(2);
    expect(bar.voices[1].beats[0].notes[0].realValue).toBe(40);
    expect(r.report.ignored).toEqual({ pickScrape: 1, tremoloPicking: 1 });
  });

  it('writes a five-string bass in its own tuning', () => {
    const tuning = [43, 38, 33, 28, 23];
    const r = ok(songsterrToAlphaTex(song([m([b(1, [{ string: 4, fret: 2 }])])], {}, tuning), META));
    const staff = importTex(r.alphaTex).tracks[0].staves[0];
    expect(staff.tuning).toEqual(tuning);
    expect(staff.bars[0].voices[0].beats[0].notes[0].realValue).toBe(25);
  });

  it('refuses parts without notes', () => {
    expect(songsterrToAlphaTex([], META).ok).toBe(false);
    const rests = songsterrToAlphaTex(song([m([b(1, [{ rest: true }], { rest: true })])]), META);
    expect(rests.ok).toBe(false);
  });

  it('escapes names and titles', () => {
    const input = song([m([b(1, [{ string: 0, fret: 0 }])])]);
    input[0].track.name = 'A "quoted" \\ name | Lead Guitar';
    const r = ok(songsterrToAlphaTex(input, { title: 'Say "hi"', artist: 'Back\\slash' }));
    const score = importTex(r.alphaTex);
    expect(score.title).toBe('Say "hi"');
    expect(score.artist).toBe('Back\\slash');
  });
});
