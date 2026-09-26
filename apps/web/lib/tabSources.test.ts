import { describe, expect, it } from 'vitest';
import {
  drawableTabs,
  emptyStateFor,
  followTrackChange,
  isTabsPathFor,
  orderSources,
  pickTab,
  pickerLabel,
  ratingLabel,
  sourceChipLabel,
  tabsHref,
  trackIdFromParam,
  type TabSummary,
} from './tabSources';

const song = { id: 'upload:song1', title: 'Copper Sky', artist: 'Coastline' };

function tab(over: Partial<TabSummary>): TabSummary {
  return {
    id: 'row',
    kind: 'file',
    title: 'Copper Sky',
    artist: 'Coastline',
    instrument: null,
    trackId: null,
    ext: '.gp',
    format: 'gp',
    shared: true,
    mine: false,
    canDelete: false,
    offsetMs: 0,
    addedBy: 'Mira',
    downloadUrl: '/api/tabs/files/row/download',
    ...over,
  };
}

const match = { id: 1, artist: 'Coastline', title: 'Copper Sky', hasChords: false, instruments: ['Guitar'], url: 'https://songsterr/1' };

/** A tab generated from the recording by an older server, as a cached
 *  answer from before this build could still hand it over. */
const oldGenerated = (over: Partial<TabSummary> = {}) =>
  tab({ id: 'g', kind: 'generated' as never, trackId: song.id, downloadUrl: '/api/tabs/generated/upload%3Asong1', ...over });

describe('the source chain on the page', () => {
  it('a generated tab is never drawn, whatever order it arrives in', () => {
    const file = tab({ id: 'f' });
    expect(drawableTabs([oldGenerated(), file]).map((t) => t.id)).toEqual(['f']);
    expect(drawableTabs([oldGenerated()])).toEqual([]);
    expect(pickTab(drawableTabs([oldGenerated(), file]), null)?.id).toBe('f');
  });

  it('a stale pick of a generated tab falls back to the first real tab', () => {
    expect(pickTab(drawableTabs([oldGenerated(), tab({ id: 'f' })]), 'g')?.id).toBe('f');
    expect(pickTab(drawableTabs([oldGenerated()]), 'g')).toBeNull();
  });

  it('the listener’s pick wins while it exists, else the first in the chain', () => {
    const tabs = [tab({ id: 'f' }), tab({ id: 'p', kind: 'pasted' })];
    expect(pickTab(tabs, 'p')?.id).toBe('p');
    expect(pickTab(tabs, 'deleted')?.id).toBe('f');
    expect(pickTab([], null)).toBeNull();
  });
});

describe('the source chip', () => {
  it('names who added a shared file', () => {
    expect(sourceChipLabel(tab({}))).toBe('File added by Mira, shared');
  });

  it('says you for your own, and private for a tab from before sharing', () => {
    expect(sourceChipLabel(tab({ mine: true, shared: false }))).toBe('File added by you, private');
  });

  it('someone when the name is unknown', () => {
    expect(sourceChipLabel(tab({ addedBy: null }))).toBe('File added by someone, shared');
  });

  it('a pasted text tab names who pasted it', () => {
    expect(sourceChipLabel(tab({ kind: 'pasted', format: 'alphatex' }))).toBe('Text tab pasted by Mira, shared');
    expect(sourceChipLabel(tab({ kind: 'pasted', mine: true }))).toBe('Text tab pasted by you, shared');
  });

  it('the picker says what each tab is, who added it and the instrument', () => {
    expect(pickerLabel(tab({ instrument: 'Guitar' }))).toBe('Guitar Pro file, Mira, Guitar');
    expect(pickerLabel(tab({ format: 'musicxml' }))).toBe('MusicXML file, Mira');
    expect(pickerLabel(tab({ kind: 'pasted', instrument: 'Guitar' }))).toBe('Text tab, Mira, Guitar');
  });
});

describe('pasted text tabs in the chain', () => {
  it('file, then pasted, whatever order they arrive in', () => {
    const pasted = tab({ id: 'p', kind: 'pasted' });
    const file = tab({ id: 'f' });
    expect(drawableTabs([oldGenerated(), pasted, file]).map((t) => t.id)).toEqual(['f', 'p']);
    expect(pickTab(drawableTabs([oldGenerated(), pasted]), null)?.id).toBe('p');
  });
});

describe('tabs found online in the chain', () => {
  const ug = (over: Partial<TabSummary> = {}, src: Partial<NonNullable<TabSummary['source']>> = {}) =>
    tab({
      id: 'u',
      kind: 'fetched',
      source: {
        site: 'ug',
        siteLabel: 'Ultimate Guitar',
        url: 'https://tabs.ultimate-guitar.com/tab/a/b-tabs-1',
        part: 'guitar',
        version: 1,
        rating: 4.71,
        votes: 1371,
        ...src,
      },
      ...over,
    });

  it('file, then pasted, then fetched', () => {
    const pasted = tab({ id: 'p', kind: 'pasted' });
    const file = tab({ id: 'f' });
    expect(drawableTabs([oldGenerated(), ug(), pasted, file]).map((t) => t.id)).toEqual(['f', 'p', 'u']);
    expect(pickTab(drawableTabs([oldGenerated(), ug()]), null)?.id).toBe('u');
    expect(orderSources([oldGenerated(), ug(), file], [match]).map((x) => x.type)).toEqual(['file', 'fetched', 'songsterr']);
  });

  it('the chip names the site and says it is not lined up yet', () => {
    expect(sourceChipLabel(ug())).toBe('From Ultimate Guitar, not lined up yet');
    expect(sourceChipLabel(ug({}, { version: 2, part: 'bass' }))).toBe('From Ultimate Guitar, ver 2, bass, not lined up yet');
  });

  it('the picker gives site, type, version and rating', () => {
    expect(pickerLabel(ug())).toBe('Ultimate Guitar, Text tab, ★ 4.7 (1,371 votes)');
    expect(pickerLabel(ug({}, { part: 'bass', version: 3, votes: 1 }))).toBe('Ultimate Guitar, Bass tab, ver 3, ★ 4.7 (1 vote)');
    expect(pickerLabel(ug({}, { rating: 0 }))).toBe('Ultimate Guitar, Text tab');
    expect(ratingLabel(ug({}, { rating: null }).source!)).toBe('');
  });

});

describe('empty states (the Songsterr list)', () => {
  const base = { loading: false, searchingOnline: false, matchesLoading: false, matches: [] };

  it('still looking while the store, Songsterr or the online search has not answered', () => {
    expect(emptyStateFor({ ...base, loading: true })).toEqual({ kind: 'searching' });
    expect(emptyStateFor({ ...base, matchesLoading: true })).toEqual({ kind: 'searching' });
    expect(emptyStateFor({ ...base, searchingOnline: true })).toEqual({ kind: 'searching' });
    // Songsterr answered, but the online search may still bring a tab to draw.
    expect(emptyStateFor({ ...base, searchingOnline: true, matches: [match] })).toEqual({ kind: 'searching' });
  });

  it('Songsterr has the song: its versions, in its order', () => {
    const two = { ...match, id: 2, title: 'Copper Sky (Live)' };
    expect(emptyStateFor({ ...base, matches: [match, two] })).toEqual({ kind: 'matches', matches: [match, two] });
  });

  it('nothing on Songsterr', () => {
    expect(emptyStateFor(base)).toEqual({ kind: 'none' });
  });
});

describe('routes', () => {
  it('encodes the compound id and reads it back', () => {
    expect(tabsHref('youtube:dQw4w9WgXcQ')).toBe('/tabs/youtube%3AdQw4w9WgXcQ');
    expect(trackIdFromParam('youtube%3AdQw4w9WgXcQ')).toBe('youtube:dQw4w9WgXcQ');
    expect(trackIdFromParam('upload:abc')).toBe('upload:abc');
    expect(trackIdFromParam('%E0%A4%A')).toBe('%E0%A4%A');
  });

  it('knows its own page, encoded or not', () => {
    expect(isTabsPathFor('/tabs/upload%3Aabc', 'upload:abc')).toBe(true);
    expect(isTabsPathFor('/tabs/upload:abc', 'upload:abc')).toBe(true);
    expect(isTabsPathFor('/tabs/upload%3Aother', 'upload:abc')).toBe(false);
    expect(isTabsPathFor('/library', 'upload:abc')).toBe(false);
    expect(isTabsPathFor(null, 'upload:abc')).toBe(false);
  });

  it('follows the player to the next song when the page showed the playing one', () => {
    expect(followTrackChange('upload:a', 'upload:a', 'upload:b')).toBe('/tabs/upload%3Ab');
  });

  it('stays put for a song that was not playing, on the first render, or when nothing changed', () => {
    expect(followTrackChange('upload:x', 'upload:a', 'upload:b')).toBeNull();
    expect(followTrackChange('upload:a', null, 'upload:a')).toBeNull();
    expect(followTrackChange('upload:a', 'upload:a', 'upload:a')).toBeNull();
    expect(followTrackChange('upload:a', 'upload:a', null)).toBeNull();
  });
});
