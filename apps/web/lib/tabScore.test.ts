import { describe, expect, it } from 'vitest';
import { keyName, metaLine, noteName, scoreInfo, scoreScale, shortTuningName, stringsText } from './tabScore';

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
      staves: [{ tuning: [64, 59, 55, 50, 45, 38], tuningName: 'Guitar Dropped D Tuning' }],
    },
    {
      name: 'Bass',
      playbackInfo: { program: 33 },
      staves: [{ tuning: [43, 38, 33, 26], tuningName: 'Bass Dropped D Tuning' }],
    },
  ],
};

describe('reading a score for the header and picker', () => {
  it('reads tempo, key, instruments and tunings', () => {
    expect(scoreInfo(COPPER_SKY)).toEqual({
      tempo: 96,
      key: 'D minor',
      tracks: [
        { index: 0, name: 'Guitar', instrument: 'Distortion guitar', tuning: 'Drop D', strings: 'D A D G B E' },
        { index: 1, name: 'Bass', instrument: 'Bass', tuning: 'Drop D', strings: 'D A D G' },
      ],
    });
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
    expect(scoreInfo(null)).toEqual({ tempo: null, key: null, tracks: [] });
    expect(scoreInfo({ tracks: [{}] }).tracks[0]).toMatchObject({ name: 'Track 1', tuning: '', strings: '' });
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
