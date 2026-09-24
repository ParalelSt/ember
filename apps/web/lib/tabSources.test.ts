import { describe, expect, it } from 'vitest';
import {
  canGenerateFor,
  drawableTabs,
  emptyStateFor,
  followTrackChange,
  isTabsPathFor,
  localOffsetId,
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

describe('the source chain on the page', () => {
  it('a file beats a generated tab, whatever order they arrive in', () => {
    const gen = tab({ id: 'g', kind: 'generated', trackId: song.id });
    const file = tab({ id: 'f' });
    const tabs = drawableTabs([gen, file], 'ready', song);
    expect(tabs.map((t) => t.id)).toEqual(['f', 'g']);
    expect(pickTab(tabs, null)?.id).toBe('f');
  });

  it('the generated tab of this very recording comes before one of another recording', () => {
    const other = tab({ id: 'other', kind: 'generated', trackId: 'youtube:elsewhere' });
    const own = tab({ id: 'own', kind: 'generated', trackId: song.id });
    expect(drawableTabs([other, own], 'none', song).map((t) => t.id)).toEqual(['own', 'other']);
  });

  it('a generated tab ready on disk without a row yet stands in for it', () => {
    const tabs = drawableTabs([], 'ready', song);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ kind: 'generated', trackId: song.id, downloadUrl: '/api/tabs/generated/upload%3Asong1' });
  });

  it('no stand-in while generating, failed, or never asked for', () => {
    for (const s of ['running', 'failed', 'none'] as const) expect(drawableTabs([], s, song)).toEqual([]);
  });

  it('the listener’s pick wins while it exists, else the first in the chain', () => {
    const tabs = [tab({ id: 'f' }), tab({ id: 'g', kind: 'generated' })];
    expect(pickTab(tabs, 'g')?.id).toBe('g');
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

  it('a generated tab says where it came from, and that it is rough', () => {
    expect(sourceChipLabel(tab({ kind: 'generated' }))).toBe('Generated from the recording, rough');
  });

  it('a pasted text tab names who pasted it', () => {
    expect(sourceChipLabel(tab({ kind: 'pasted', format: 'alphatex' }))).toBe('Text tab pasted by Mira, shared');
    expect(sourceChipLabel(tab({ kind: 'pasted', mine: true }))).toBe('Text tab pasted by you, shared');
  });

  it('the picker says what each tab is, who added it and the instrument', () => {
    expect(pickerLabel(tab({ instrument: 'Guitar' }))).toBe('Guitar Pro file, Mira, Guitar');
    expect(pickerLabel(tab({ format: 'musicxml' }))).toBe('MusicXML file, Mira');
    expect(pickerLabel(tab({ kind: 'pasted', instrument: 'Guitar' }))).toBe('Text tab, Mira, Guitar');
    expect(pickerLabel(tab({ kind: 'generated', instrument: 'Guitar' }))).toBe('Generated, rough');
  });
});

describe('pasted text tabs in the chain', () => {
  it('file, then pasted, then generated, whatever order they arrive in', () => {
    const gen = tab({ id: 'g', kind: 'generated', trackId: song.id });
    const pasted = tab({ id: 'p', kind: 'pasted' });
    const file = tab({ id: 'f' });
    expect(drawableTabs([gen, pasted, file], 'ready', song).map((t) => t.id)).toEqual(['f', 'p', 'g']);
    expect(pickTab(drawableTabs([gen, pasted], 'ready', song), null)?.id).toBe('p');
  });

  it('keeps its own sync nudge key (its row id)', () => {
    expect(localOffsetId(tab({ id: 'p', kind: 'pasted', trackId: song.id }))).toBe('p');
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

  it('file, then pasted, then fetched, then generated', () => {
    const gen = tab({ id: 'g', kind: 'generated', trackId: song.id });
    const pasted = tab({ id: 'p', kind: 'pasted' });
    const file = tab({ id: 'f' });
    expect(drawableTabs([gen, ug(), pasted, file], 'ready', song).map((t) => t.id)).toEqual(['f', 'p', 'u', 'g']);
    expect(pickTab(drawableTabs([gen, ug()], 'ready', song), null)?.id).toBe('u');
    expect(orderSources([gen, ug(), file], []).map((x) => x.type)).toEqual(['file', 'fetched', 'generated']);
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

  it('keeps its own sync nudge key (its row id)', () => {
    expect(localOffsetId(ug({ trackId: song.id }))).toBe('u');
  });

  it('while the online search runs with nothing to draw: Finding a tab online', () => {
    const base = { loading: false, generated: 'none' as const, generating: false, generateError: null, canGenerate: true, matches: [] };
    expect(emptyStateFor({ ...base, searchingOnline: true })).toEqual({ kind: 'searching' });
    expect(emptyStateFor({ ...base, loading: true, searchingOnline: true })).toEqual({ kind: 'loading' });
    expect(emptyStateFor({ ...base, searchingOnline: false }).kind).toBe('empty');
  });
});

describe('empty states', () => {
  const base = { loading: false, generated: 'none' as const, generating: false, generateError: null, canGenerate: true, matches: [] };

  it('loading first', () => {
    expect(emptyStateFor({ ...base, loading: true }).kind).toBe('loading');
  });

  it('offers to generate a YouTube or uploaded song', () => {
    expect(emptyStateFor(base)).toEqual({ kind: 'empty', canGenerate: true, failed: null, unavailable: null, songsterr: [] });
  });

  it('a running job, or the click that starts one, shows the transcribing state', () => {
    expect(emptyStateFor({ ...base, generated: 'running' }).kind).toBe('generating');
    expect(emptyStateFor({ ...base, generating: true }).kind).toBe('generating');
  });

  it('a failed job says why, and still offers to try again', () => {
    expect(emptyStateFor({ ...base, generated: 'failed', generateError: 'No audio' })).toMatchObject({
      kind: 'empty',
      canGenerate: true,
      failed: 'No audio',
    });
  });

  it('Songsterr only: the link-out is all there is', () => {
    expect(emptyStateFor({ ...base, canGenerate: false, matches: [match] })).toEqual({
      kind: 'empty',
      canGenerate: false,
      failed: null,
      unavailable: null,
      songsterr: [match],
    });
  });

  it('a server without the tab tools: the reason, once, never the raw Python error', () => {
    const why = 'Generating a tab needs the optional tab tools on the server';
    expect(emptyStateFor({ ...base, generateUnavailable: why })).toMatchObject({ canGenerate: true, unavailable: why, failed: null });
    // A job that failed on the missing module before the page knew.
    const failed = emptyStateFor({ ...base, generated: 'failed', generateError: "ModuleNotFoundError: No module named 'basic_pitch'" });
    expect(failed).toMatchObject({ unavailable: null });
    expect(failed.kind === 'empty' && failed.failed).toContain('optional tab tools on the server');
    expect(failed.kind === 'empty' && failed.failed).not.toContain('ModuleNotFoundError');
    expect(emptyStateFor({ ...base, generated: 'failed', generateError: "No module named 'basic_pitch'", generateUnavailable: why })).toMatchObject({
      failed: null,
      unavailable: why,
    });
    // Not offered at all: nothing to explain.
    expect(emptyStateFor({ ...base, canGenerate: false, generateUnavailable: why })).toMatchObject({ unavailable: null });
  });

  it('a request that could not start a job says why', () => {
    expect(emptyStateFor({ ...base, startError: 'Too many requests' })).toMatchObject({ failed: 'Too many requests' });
  });

  it('generating is offered only for recordings Ember has', () => {
    expect(canGenerateFor('youtube:abc')).toBe(true);
    expect(canGenerateFor('upload:abc')).toBe(true);
    expect(canGenerateFor('jamendo:1')).toBe(false);
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

  it('a generated tab keeps its nudge under the old viewer key', () => {
    expect(localOffsetId(tab({ id: 'rowid', kind: 'generated', trackId: 'upload:a' }))).toBe('generated:upload:a');
    expect(localOffsetId(tab({ id: 'rowid' }))).toBe('rowid');
  });
});
