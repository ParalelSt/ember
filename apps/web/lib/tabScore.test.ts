import { describe, expect, it } from 'vitest';
import {
  displaySettings,
  keyName,
  metaLine,
  noteName,
  scoreInfo,
  scoreScale,
  shortTuningName,
  staveProfileOf,
  stringsText,
  trackIndexIn,
} from './tabScore';

// The Copper Sky sample as AlphaTab parses it (checked in Node against the
// real module): drop D guitar on program 30 and drop D bass on 33, 96 bpm,
// D minor (one flat, minor).
const COPPER_SKY = {
  tempo: 96,
  masterBars: [{ keySignature: -1, keySignatureType: 1 }],
  tracks: [
    {
      name: 'Guitar',
      playbackInfo: { program: 30 },
      staves: [{ tuning: [64, 59, 55, 50, 45, 38], tuningName: 'Guitar Dropped D Tuning', showTablature: true }],
    },
    {
      name: 'Bass',
      playbackInfo: { program: 33 },
      staves: [{ tuning: [43, 38, 33, 26], tuningName: 'Bass Dropped D Tuning', showTablature: true }],
    },
  ],
};

describe('reading a score for the header and picker', () => {
  it('reads tempo, key, instruments and tunings', () => {
    expect(scoreInfo(COPPER_SKY)).toEqual({
      tempo: 96,
      signature: null,
      key: 'D minor',
      tracks: [
        { index: 0, name: 'Guitar', instrument: 'Distortion guitar', tuning: 'Drop D', strings: 'D A D G B E', tab: true },
        { index: 1, name: 'Bass', instrument: 'Bass', tuning: 'Drop D', strings: 'D A D G', tab: true },
      ],
    });
  });

  it('reads the first bar\'s time signature for counting beats', () => {
    const info = scoreInfo({ ...COPPER_SKY, masterBars: [{ timeSignatureNumerator: 6, timeSignatureDenominator: 8 }] });
    expect(info.signature).toEqual({ numerator: 6, denominator: 8 });
  });

  it('builds the approved meta line for the shown track', () => {
    const info = scoreInfo(COPPER_SKY);
    expect(metaLine('Coastline', info, 0)).toBe('Coastline · 96 bpm · D minor · Distortion guitar, Drop D (D A D G B E)');
    expect(metaLine('Coastline', info, 1)).toBe('Coastline · 96 bpm · D minor · Bass, Drop D (D A D G)');
  });

  it('leaves out what it does not know', () => {
    expect(metaLine('Coastline', null, 0)).toBe('Coastline');
    expect(metaLine('', scoreInfo({ tracks: [{ name: 'Lead', staves: [{}] }] }), 0)).toBe('Lead');
  });

  it('survives an empty or odd score', () => {
    expect(scoreInfo(null)).toEqual({ tempo: null, signature: null, key: null, tracks: [] });
    expect(scoreInfo({ tracks: [{}] }).tracks[0]).toMatchObject({ name: 'Track 1', tuning: '', strings: '' });
  });
});

// AlphaTab's stave profiles, as the module exports them.
const AT = {
  StaveProfile: { Tab: 'tab', ScoreTab: 'score-tab' },
  LayoutMode: { Page: 'page', Horizontal: 'horizontal' },
  TabRhythmMode: { ShowWithBars: 'bars' },
  NotationElement: new Proxy({}, { get: (_t, k) => String(k) }),
};

describe('what a score can be drawn as', () => {
  it('sees which instruments carry tablature', () => {
    const info = scoreInfo({
      tracks: [
        { name: 'Guitar', staves: [{ tuning: [64, 59, 55, 50, 45, 38], showTablature: true }] },
        { name: 'Piano', staves: [{ tuning: [], showTablature: false }] },
      ],
    });
    expect(info.tracks.map((t) => t.tab)).toEqual([true, false]);
  });

  // A MusicXML export with no string and fret numbers has no tablature
  // staff; AlphaTab's Tab profile then lays out an empty system and throws
  // ("can't access property staves"), drawing nothing at all.
  it('falls back to Tab + Score for a file with no tablature', () => {
    expect(staveProfileOf(AT, 'tab', true)).toBe('tab');
    expect(staveProfileOf(AT, 'tab', false)).toBe('score-tab');
    expect(staveProfileOf(AT, 'score-tab', true)).toBe('score-tab');
    expect(displaySettings(AT, { staff: 'tab', scroll: 'vertical', scale: 1, hasTab: false }).display.staveProfile)
      .toBe('score-tab');
    // Unknown (no score read yet) draws as asked.
    expect(displaySettings(AT, { staff: 'tab', scroll: 'vertical', scale: 1 }).display.staveProfile).toBe('tab');
  });

  // Handed an index it cannot resolve, AlphaTab renders no track at all and
  // then throws inside its layout, so the index is clamped to the score.
  it('clamps the instrument index to the score in hand', () => {
    expect(trackIndexIn(4, 3)).toBe(3);
    expect(trackIndexIn(2, 3)).toBe(1);
    expect(trackIndexIn(2, 2)).toBe(1);
    expect(trackIndexIn(1, 9)).toBe(0);
    expect(trackIndexIn(0, 2)).toBe(0);
    expect(trackIndexIn(3, -1)).toBe(0);
    expect(trackIndexIn(3, Number.NaN)).toBe(0);
  });
});

describe('names', () => {
  it('keys from the circle of fifths; C major (an unmarked file) says nothing', () => {
    expect(keyName(0, 0)).toBeNull();
    expect(keyName(0, 1)).toBe('A minor');
    expect(keyName(-1, 1)).toBe('D minor');
    expect(keyName(2, 0)).toBe('D major');
    expect(keyName(-3, 0)).toBe('Eb major');
    expect(keyName(9, 0)).toBeNull();
  });

  it('tunings the way players say them', () => {
    expect(shortTuningName('Guitar Dropped D Tuning')).toBe('Drop D');
    expect(shortTuningName('Guitar Standard Tuning')).toBe('Standard');
    expect(shortTuningName('Open G')).toBe('Open G');
  });

  it('strings low to high', () => {
    expect(stringsText([64, 59, 55, 50, 45, 40])).toBe('E A D G B E');
    expect(noteName(61)).toBe('C#');
  });

  it('draws smaller on phones', () => {
    expect(scoreScale(true)).toBe(0.65);
    expect(scoreScale(false)).toBe(0.95);
  });
});
