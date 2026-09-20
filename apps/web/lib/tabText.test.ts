// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { fitTempo, MAX_TAB_TEXT_BYTES, parseTabText, reportLine, tapTempo, type TabTextResult } from '@/lib/tabText';

// The text tab parser against a fixture set of our own riffs, written in
// the shapes text tabs come in (tests/fixtures/tabs-text). Every output is
// imported by the installed AlphaTab, and the checks read the score it
// builds: bars, tuning, and where each beat starts, in 16ths.

const FIXTURES = path.resolve(__dirname, '../../../tests/fixtures/tabs-text');
const read = (name: string) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

interface Beat {
  /** Start inside the bar, in 16ths. */
  slot: number;
  /** "fret@string" (string 1 = the top line), plus effects. */
  notes: string[];
  tap: boolean;
}

/** AlphaTab's own reading of the alphaTex. Throws on anything it rejects. */
function importTex(tex: string) {
  const imp = new alphaTab.importer.AlphaTexImporter();
  imp.initFromString(tex, new alphaTab.Settings());
  const score = imp.readScore();
  const staff = score.tracks[0].staves[0];
  const strings = staff.tuning.length;
  const bars: Beat[][] = staff.bars.map((bar) =>
    bar.voices[0].beats
      .filter((b) => b.notes.length > 0)
      .map((b) => ({
        slot: b.playbackStart / 240,
        tap: b.tap,
        notes: b.notes.map((n) => {
          const fx = [
            n.isHammerPullOrigin && 'h',
            n.slideOutType && 'sl',
            n.slideInType && 'si',
            n.harmonicType && 'nh',
            n.hasBend && `b${n.bendPoints!.map((p) => p.value).join(',')}`,
            n.vibrato && 'v',
            n.isDead && 'x',
            n.isGhost && 'g',
            n.isPalmMute && 'pm',
          ].filter(Boolean);
          return `${n.fret}@${strings + 1 - n.string}${fx.length ? `{${fx.join(' ')}}` : ''}`;
        }),
      })),
  );
  return {
    score,
    staff,
    bars,
    slots: bars.map((b) => b.map((x) => x.slot)),
    sections: score.masterBars.filter((m) => m.section).map((m) => `${m.index + 1}:${m.section!.text}`),
    noteCount: bars.flat().reduce((n, b) => n + b.notes.length, 0),
  };
}

function ok(r: TabTextResult) {
  if (!r.ok) throw new Error(`refused: ${r.error}`);
  return r;
}

/** What each fixture must come out as. */
const TABLE: {
  file: string;
  strings: number;
  tuningName: string;
  tuning: number[];
  bars: number;
  notes: number;
  slots: Record<number, number[]>;
  tempo?: number;
  skipped?: number;
  warn?: RegExp[];
  noWarnings?: boolean;
}[] = [
  {
    file: 'standard-6.txt',
    strings: 6,
    tuningName: 'Standard',
    tuning: [64, 59, 55, 50, 45, 40],
    bars: 2,
    notes: 8,
    slots: { 1: [0, 4, 8, 12], 2: [0, 4, 8, 12] },
    tempo: 100,
    skipped: 1,
    noWarnings: true,
  },
  {
    file: 'drop-d.txt',
    strings: 6,
    tuningName: 'Drop D',
    tuning: [64, 59, 55, 50, 45, 38],
    bars: 2,
    notes: 30,
    slots: { 1: [0, 2, 4, 8, 12], 2: [0, 2, 4, 8, 12] },
    skipped: 1,
    warn: [/No tempo/],
  },
  {
    file: 'seven-string.txt',
    strings: 7,
    tuningName: 'Drop A',
    tuning: [64, 59, 55, 50, 45, 40, 33],
    bars: 1,
    notes: 5,
    slots: { 1: [0, 4, 8, 12] },
  },
  {
    file: 'bass-4.txt',
    strings: 4,
    tuningName: 'Standard',
    tuning: [43, 38, 33, 28],
    bars: 4,
    notes: 14,
    slots: { 1: [0, 4, 8], 2: [0, 4, 8, 12], 3: [0, 4, 8], 4: [0, 4, 8, 12] },
  },
  {
    file: 'bass-5.txt',
    strings: 5,
    tuningName: 'Standard',
    tuning: [43, 38, 33, 28, 23],
    bars: 1,
    notes: 4,
    slots: { 1: [0, 4, 8, 12] },
  },
  {
    file: 'chords.txt',
    strings: 6,
    tuningName: 'Standard',
    tuning: [64, 59, 55, 50, 45, 40],
    bars: 2,
    notes: 14,
    slots: { 1: [0, 8], 2: [0, 8] },
  },
  {
    file: 'techniques.txt',
    strings: 6,
    tuningName: 'Standard',
    tuning: [64, 59, 55, 50, 45, 40],
    bars: 4,
    notes: 18,
    slots: { 1: [0, 2, 4, 6, 8, 10], 3: [0, 4, 6, 8, 12], 4: [0, 6, 8, 11] },
    tempo: 90,
    noWarnings: true,
  },
  {
    file: 'repeats.txt',
    strings: 6,
    tuningName: 'Standard',
    tuning: [64, 59, 55, 50, 45, 40],
    bars: 10,
    notes: 31,
    slots: { 1: [0, 4, 8, 12], 2: [0], 5: [0, 4, 8, 12], 6: [0], 7: [0, 4, 8, 12], 10: [0, 4, 8, 12] },
  },
  {
    file: 'rhythm.txt',
    strings: 6,
    tuningName: 'Standard',
    tuning: [64, 59, 55, 50, 45, 40],
    bars: 2,
    notes: 7,
    // Q. E Q Q and H Q. E: the letters, not the spacing (which would put
    // bar 1 at 0 3 5 7).
    slots: { 1: [0, 6, 8, 12], 2: [0, 8, 14] },
    tempo: 110,
    noWarnings: true,
  },
  {
    file: 'lyrics-chords.txt',
    strings: 6,
    tuningName: 'Standard',
    tuning: [64, 59, 55, 50, 45, 40],
    bars: 3,
    notes: 35,
    slots: { 1: [0, 8, 10], 2: [0, 8], 3: [0, 4, 8] },
    tempo: 84,
    skipped: 6,
    noWarnings: true,
  },
  {
    file: 'messy.txt',
    strings: 6,
    tuningName: 'Standard',
    tuning: [64, 59, 55, 50, 45, 40],
    bars: 2,
    notes: 10,
    slots: { 1: [0, 1, 2, 3, 6, 7, 9, 10], 2: [0, 4] },
    skipped: 1,
    warn: [/longer than others/],
  },
  {
    file: 'no-bars.txt',
    strings: 6,
    tuningName: 'Standard',
    tuning: [64, 59, 55, 50, 45, 40],
    bars: 2,
    notes: 5,
    slots: { 1: [0, 4, 8], 2: [0, 8] },
    warn: [/No bar lines, so a bar is every 16 columns/],
  },
];

describe('parseTabText fixtures', () => {
  for (const t of TABLE) {
    it(`${t.file}: ${t.strings} strings, ${t.tuningName}, ${t.bars} bars, ${t.notes} notes`, () => {
      const r = ok(parseTabText(read(t.file), { title: t.file }));
      expect(r.report).toMatchObject({ strings: t.strings, tuningName: t.tuningName, tuningMidi: t.tuning, bars: t.bars, notes: t.notes });
      if (t.tempo) expect(r.report).toMatchObject({ tempo: t.tempo, tempoSource: 'text' });
      if (t.skipped !== undefined) expect(r.report.skipped).toHaveLength(t.skipped);
      for (const w of t.warn ?? []) expect(r.report.warnings.some((x) => w.test(x))).toBe(true);
      if (t.noWarnings) expect(r.report.warnings).toEqual([]);

      // AlphaTab reads it back to the same thing.
      const at = importTex(r.alphaTex);
      expect(at.staff.bars).toHaveLength(t.bars);
      expect(at.staff.tuning).toEqual(t.tuning);
      expect(at.noteCount).toBe(t.notes);
      for (const [bar, slots] of Object.entries(t.slots)) expect(at.slots[Number(bar) - 1]).toEqual(slots);
      // 4/4 throughout, nothing overfull: the timeline is linear for sync.
      for (const mb of at.score.masterBars) {
        expect([mb.timeSignatureNumerator, mb.timeSignatureDenominator]).toEqual([4, 4]);
      }
    });
  }
});

describe('what the fixtures carry', () => {
  it('standard 6: the first note of each beat on the right string and fret', () => {
    const at = importTex(ok(parseTabText(read('standard-6.txt'))).alphaTex);
    expect(at.bars[0].map((b) => b.notes)).toEqual([['3@6'], ['0@5'], ['2@5'], ['3@5']]);
    expect(at.score.tempo).toBe(100);
  });

  it('drop D: the bottom D is D2, palm mutes follow the PM line, the section heading lands', () => {
    const r = ok(parseTabText(read('drop-d.txt')));
    expect(r.report.tuning).toEqual(['E4', 'B3', 'G3', 'D3', 'A2', 'D2']);
    const at = importTex(r.alphaTex);
    expect(at.bars[0][0].notes).toEqual(['0@4{pm}', '0@5{pm}', '0@6{pm}']);
    expect(at.bars[0][2].notes.every((n) => n.endsWith('{pm}'))).toBe(true);
    expect(at.bars[0][3].notes).toEqual(['5@4', '5@5', '5@6']);
    expect(at.bars[1][0].notes.every((n) => n.endsWith('{pm}'))).toBe(true);
    expect(at.sections).toEqual(['1:Riff']);
  });

  it('7-string: a second A label at the bottom is A1', () => {
    const r = ok(parseTabText(read('seven-string.txt')));
    expect(r.report.tuning.at(-1)).toBe('A1');
    expect(importTex(r.alphaTex).bars[0][3].notes).toEqual(['5@6', '3@7']);
  });

  it('bass: a bass track, and "x2" on its own line plays the block twice', () => {
    const r = ok(parseTabText(read('bass-4.txt')));
    expect(r.report.instrument).toBe('bass');
    expect(r.alphaTex).toContain('\\instrument 33');
    const at = importTex(r.alphaTex);
    expect(at.score.tracks[0].playbackInfo.program).toBe(33);
    expect(at.bars[2]).toEqual(at.bars[0]);
    expect(ok(parseTabText(read('bass-5.txt'))).report.tuning).toEqual(['G2', 'D2', 'A1', 'E1', 'B0']);
  });

  it('stacked chords are one beat; a two-digit fret a column late still joins its chord', () => {
    const at = importTex(ok(parseTabText(read('chords.txt'))).alphaTex);
    expect(at.bars[0][0].notes).toEqual(['3@2', '2@3', '0@4']);
    expect(at.bars[1][0].notes).toEqual(['10@2', '11@3', '12@4', '10@5']);
    expect(at.bars[1]).toHaveLength(2);
  });

  it('techniques: hammer, pull, slides, bends, release, vibrato, ghost, dead, tap, harmonic', () => {
    const r = ok(parseTabText(read('techniques.txt')));
    expect(r.report.ignoredMarks).toBe(0);
    const at = importTex(r.alphaTex);
    expect(at.bars[0].map((b) => b.notes[0])).toEqual(['5@2{h}', '7@2', '8@2{h}', '7@2', '5@2{sl}', '7@2']);
    // 7b9: two semitones up (4 quarter tones); 7b9r7: up and back.
    expect(at.bars[1].map((b) => b.notes[0])).toEqual(['7@3{b0,4}', '7@3{b0,4,4,0}', '9@3{v}']);
    expect(at.bars[2].map((b) => b.notes[0])).toEqual(['5@5{g}', '0@5{x}', '0@5{x}', '12@5{h}', '5@5']);
    expect(at.bars[2][3].tap).toBe(true);
    expect(at.bars[3].map((b) => b.notes[0])).toEqual(['12@5{nh}', '7@5{sl}', '5@5', '7@5{si}']);
  });

  it('repeats: |: :| x3 plays the intro three times, x4 the verse four, sections once', () => {
    const at = importTex(ok(parseTabText(read('repeats.txt'))).alphaTex);
    expect(at.bars[2]).toEqual(at.bars[0]);
    expect(at.bars[4]).toEqual(at.bars[0]);
    expect(at.bars[5]).toEqual(at.bars[1]);
    expect(at.sections).toEqual(['1:Intro', '7:Verse']);
  });

  it('rhythm letters give the durations', () => {
    const r = ok(parseTabText(read('rhythm.txt')));
    expect(r.report.rhythmBars).toBe(2);
    const bar = importTex(r.alphaTex).score.tracks[0].staves[0].bars[0].voices[0].beats;
    // Q. then E: a dotted quarter lasts 1440 ticks.
    expect(bar[0].playbackDuration).toBe(1440);
    expect(bar[1].playbackDuration).toBe(480);
  });

  it('lyrics, chord names and title lines are skipped with reasons; capo, tempo and sections are used', () => {
    const r = ok(parseTabText(read('lyrics-chords.txt')));
    expect(r.report.skipped.map((s) => [s.line, s.reason])).toEqual([
      [1, 'lyrics or text'],
      [2, 'lyrics or text'],
      [8, 'chord names'],
      [9, 'lyrics or text'],
      [16, 'chord names'],
      [17, 'lyrics or text'],
    ]);
    expect(r.report.capo).toBe(2);
    const at = importTex(r.alphaTex);
    expect(at.staff.capo).toBe(2);
    expect(at.sections).toEqual(['1:Verse 1', '3:Chorus']);
    expect(reportLine(r.report)).toBe('6 strings, Standard, 3 bars, 35 notes, 6 lines skipped');
  });

  it('messy: uneven lines and a trailing comment still read bar by bar', () => {
    const r = ok(parseTabText(read('messy.txt')));
    const at = importTex(r.alphaTex);
    expect(at.bars[1].map((b) => b.notes)).toEqual([['7@5'], ['5@5']]);
    expect(r.report.skipped.map((s) => s.reason)).toEqual(['lyrics or text']);
  });
});

describe('refusals and options', () => {
  it('no tab lines at all: refused, with the lines it skipped', () => {
    const r = parseTabText(read('junk.txt'));
    expect(r.ok).toBe(false);
    expect(r.report.notes).toBe(0);
    expect(r.report.skipped).toHaveLength(3);
  });

  it('tab lines with no notes: refused', () => {
    const empty = ['e|--------|', 'B|--------|', 'G|--------|', 'D|--------|', 'A|--------|', 'E|--------|'].join('\n');
    const r = parseTabText(empty);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no notes/);
  });

  it('a tempo given wins over the text, and the text tempo is still reported', () => {
    const r = ok(parseTabText(read('standard-6.txt'), { tempo: 72 }));
    expect(r.report).toMatchObject({ tempo: 72, tempoSource: 'given', textTempo: 100 });
    expect(importTex(r.alphaTex).score.tempo).toBe(72);
  });

  it('a tuning override replaces the labels; one that does not fit is ignored with a warning', () => {
    const r = ok(parseTabText(read('standard-6.txt'), { tuning: 'Eb4 Bb3 Gb3 Db3 Ab2 Eb2' }));
    expect(r.report.tuningName).toBe('Eb standard');
    expect(importTex(r.alphaTex).staff.tuning).toEqual([63, 58, 54, 49, 44, 39]);
    const bad = ok(parseTabText(read('standard-6.txt'), { tuning: 'E4 B3' }));
    expect(bad.report.tuningName).toBe('Standard');
    expect(bad.report.warnings.some((w) => /does not fit/.test(w))).toBe(true);
  });

  it('title and artist are quoted safely', () => {
    const r = ok(parseTabText(read('bass-5.txt'), { title: 'Say "hi" \\ bye', artist: 'Me' }));
    const at = importTex(r.alphaTex);
    expect(at.score.title).toBe('Say "hi" \\ bye');
    expect(at.score.artist).toBe('Me');
  });

  it('a block with a different string count is left out with a warning', () => {
    const text = `${read('standard-6.txt')}\n\n${read('bass-4.txt')}`;
    const r = ok(parseTabText(text));
    expect(r.report.strings).toBe(6);
    expect(r.report.bars).toBe(2);
    expect(r.report.warnings.some((w) => /different number of strings/.test(w))).toBe(true);
  });

  it('marks it does not know are counted, not fatal', () => {
    const text = ['e|-3*--5?--|', 'B|---------|', 'G|---------|', 'D|---------|', 'A|---------|', 'E|---------|'].join('\n');
    const r = ok(parseTabText(text));
    expect(r.report.ignoredMarks).toBe(2);
    expect(r.report.notes).toBe(2);
    importTex(r.alphaTex);
  });

  it('"00" is two open strings, "12" one fret, "35" two frets', () => {
    const text = ['e|-00-12-35---|', 'B|-----------|', 'G|-----------|', 'D|-----------|', 'A|-----------|', 'E|-----------|'].join('\n');
    const at = importTex(ok(parseTabText(text)).alphaTex);
    expect(at.bars[0].map((b) => b.notes[0])).toEqual(['0@1', '0@1', '12@1', '3@1', '5@1']);
  });

  it('labels missing: standard tuning for the string count, with a warning', () => {
    const text = ['|-3---|', '|-----|', '|-----|', '|-----|', '|-----|', '|-----|'].join('\n');
    const r = ok(parseTabText(text));
    expect(r.report.tuningName).toBe('Standard');
    expect(r.report.warnings.some((w) => /No string names/.test(w))).toBe(true);
  });

  it('the size cap is 256 KB', () => {
    expect(MAX_TAB_TEXT_BYTES).toBe(256 * 1024);
  });
});

describe('tempo helpers', () => {
  it('fit to song length: bars x 4 x 60 / duration', () => {
    expect(fitTempo(32, 80)).toBe(96);
    expect(fitTempo(0, 80)).toBeNull();
    expect(fitTempo(10, 0)).toBeNull();
  });

  it('tap along: the median gap, needs four taps', () => {
    expect(tapTempo([0, 500, 1000, 1500])).toBe(120);
    expect(tapTempo([0, 500, 1400, 1900, 2400])).toBe(120);
    expect(tapTempo([0, 500, 1000])).toBeNull();
  });
});
