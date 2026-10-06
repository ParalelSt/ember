import { describe, expect, it } from 'vitest';
import type { TabSummary } from '@/lib/tabSources';
import { instrumentChoices, instrumentKey, partFamily, partName, sourceName, tabParts, versionLabel, versionsFor } from './tabChoose';

// Choosing a tab instrument first: the tiles (what you play) and the list
// of that instrument's versions, best match first.

function tab(over: Partial<TabSummary> & { id: string }): TabSummary {
  return {
    kind: 'file',
    title: 'Copper Sky',
    artist: 'Coastline',
    instrument: null,
    trackId: 'upload:song1',
    ext: '.gp',
    format: 'gp',
    shared: true,
    mine: false,
    canDelete: false,
    offsetMs: 0,
    addedBy: 'Mira',
    downloadUrl: `/api/tabs/files/${over.id}/download`,
    ...over,
  };
}
const timing = (confidence: number) => ({ offsetMs: 0, bpm: 100, confidence, bars: [] });
const songsterr = (id: string, instruments: string[], confidence?: number) =>
  tab({
    id,
    kind: 'fetched',
    addedBy: null,
    source: { site: 'songsterr', siteLabel: 'Songsterr', url: 'https://www.songsterr.com/a/x', part: 'multi', instruments, version: 1, rating: null, votes: null },
    ...(confidence === undefined ? {} : { timing: timing(confidence) }),
  });
const ug = (id: string, part: 'guitar' | 'bass', confidence?: number) =>
  tab({
    id,
    kind: 'fetched',
    addedBy: null,
    source: { site: 'ug', siteLabel: 'Ultimate Guitar', url: 'https://tabs.ultimate-guitar.com/x', part, version: 1, rating: 4.5, votes: 10 },
    ...(confidence === undefined ? {} : { timing: timing(confidence) }),
  });

describe('partFamily and partName', () => {
  it('says a part the same way whoever named it', () => {
    expect(['Rhythm Guitar', 'rhythm gtr', 'Gtr. Rhythm'].map(partFamily)).toEqual(['Rhythm guitar', 'Rhythm guitar', 'Rhythm guitar']);
    expect(['Lead Guitar', 'Solo gtr'].map(partFamily)).toEqual(['Lead guitar', 'Lead guitar']);
    expect(['Acoustic Guitar', 'Steel-string guitar', 'Nylon guitar'].map(partFamily)).toEqual(['Acoustic guitar', 'Acoustic guitar', 'Acoustic guitar']);
    expect(['Guitar', 'Distortion guitar', 'Gtr', 'GT 1'].map(partFamily)).toEqual(['Guitar', 'Guitar', 'Guitar', 'Guitar']);
    expect(['Bass', 'Fingered bass', 'Bass Guitar'].map(partFamily)).toEqual(['Bass', 'Bass', 'Bass']);
    expect(['Drums', 'Percussion', 'Drumkit'].map(partFamily)).toEqual(['Drums', 'Drums', 'Drums']);
    expect(['Vocals', 'Lead Vox'].map(partFamily)).toEqual(['Vocals', 'Vocals']);
    expect(['Piano', 'Synth Pad'].map(partFamily)).toEqual(['Keys', 'Keys']);
    expect(partFamily('Track 1')).toBeNull();
  });

  it('a name that says nothing falls back to the instrument, then to itself', () => {
    expect(partName('Track 1', 'Clean guitar')).toBe('Guitar');
    expect(partName('Track 1', 'Violin')).toBe('Track 1');
    expect(partName('theremin')).toBe('Theremin');
    expect(partName('Lead', 'Overdriven guitar')).toBe('Lead guitar');
    // A file's default program says guitar, not which kind.
    expect(partName('Track 1', 'Acoustic Guitar (steel)')).toBe('Guitar');
    expect(partName('Track 2', 'Fingered bass')).toBe('Bass');
  });
});

describe('tabParts', () => {
  it('the drawn score’s own tracks win; then what the site said; then one guitar part', () => {
    const ss = songsterr('s1', ['Rhythm Guitar', 'Bass']);
    expect(tabParts(ss)).toEqual(['Rhythm guitar', 'Bass']);
    expect(tabParts(ss, { tabId: 's1', tracks: [{ name: 'Track 1', instrument: 'Overdriven guitar' }, { name: 'Bass' }] })).toEqual(['Guitar', 'Bass']);
    expect(tabParts(ss, { tabId: 'other', tracks: [{ name: 'Piano' }] })).toEqual(['Rhythm guitar', 'Bass']);
    expect(tabParts(ug('u1', 'bass'))).toEqual(['Bass']);
    expect(tabParts(tab({ id: 'f1', instrument: 'Lead Guitar' }))).toEqual(['Lead guitar']);
    expect(tabParts(tab({ id: 'f2' }))).toEqual(['Guitar']);
  });

  it('two parts of one tab with the same name are told apart', () => {
    expect(tabParts(songsterr('s1', ['Guitar 1', 'Guitar 2', 'Bass']))).toEqual(['Guitar', 'Guitar 2', 'Bass']);
  });

  it('matching ignores case and spaces', () => {
    expect(instrumentKey(' Rhythm guitar ')).toBe(instrumentKey('Rhythm Guitar'));
  });
});

describe('instrumentChoices', () => {
  it('every instrument once, with how many tabs hold it, in the order the best tabs hold them', () => {
    const tabs = [ug('u1', 'guitar'), songsterr('s1', ['Rhythm Guitar', 'Bass', 'Drums'], 0.9), ug('u2', 'bass'), tab({ id: 'f1', instrument: 'guitar' })];
    expect(instrumentChoices(tabs)).toEqual([
      { name: 'Rhythm guitar', key: 'rhythm guitar', count: 1 },
      { name: 'Bass', key: 'bass', count: 2 },
      { name: 'Drums', key: 'drums', count: 1 },
      { name: 'Guitar', key: 'guitar', count: 2 },
    ]);
  });

  it('a file named one way and a site’s tab named another meet on one tile', () => {
    const tabs = [tab({ id: 'f1' }), tab({ id: 'p1', kind: 'pasted', instrument: 'guitar' })];
    expect(instrumentChoices(tabs, { tabId: 'f1', tracks: [{ name: 'Gtr', instrument: 'Clean guitar' }] })).toEqual([
      { name: 'Guitar', key: 'guitar', count: 2 },
    ]);
  });

  it('nothing for no tabs', () => {
    expect(instrumentChoices([])).toEqual([]);
  });
});

describe('versionsFor', () => {
  const tabs = [
    songsterr('s1', ['Lead Guitar', 'Rhythm Guitar', 'Bass'], 0.62),
    tab({ id: 'f1', instrument: 'Rhythm Guitar' }),
    songsterr('s2', ['Rhythm Guitar'], 0.94),
    ug('u1', 'bass'),
  ];

  it('lined up ones first, surest first, then the rest as Ember ranks them; each with its track', () => {
    const v = versionsFor(tabs, 'rhythm guitar');
    expect(v.map((x) => [x.id, x.rank, x.track, x.source])).toEqual([
      ['s2', 1, 0, 'Songsterr'],
      ['s1', 2, 1, 'Songsterr'],
      ['f1', 3, 0, 'File'],
    ]);
    expect(v[0].status).toBe('Lined up 94%');
    expect(v[2].status).toBe('Not lined up yet');
  });

  it('only the tabs that hold the instrument', () => {
    expect(versionsFor(tabs, 'Bass').map((x) => [x.id, x.track])).toEqual([
      ['s1', 2],
      ['u1', 0],
    ]);
    expect(versionsFor(tabs, 'Drums')).toEqual([]);
  });

  it('the version button: where it is from and its place among them', () => {
    const v = versionsFor(tabs, 'Rhythm Guitar');
    expect(versionLabel(v, tabs[0])).toBe('Songsterr · 2 of 3');
    expect(versionLabel(v, tabs[1])).toBe('File · 3 of 3');
    // A tab not in the list (another instrument shown): just its source.
    expect(versionLabel(v, tabs[3])).toBe('Ultimate Guitar');
  });

  it('a pasted tab is a text tab', () => {
    expect(sourceName(tab({ id: 'p1', kind: 'pasted' }))).toBe('Text tab');
  });
});
