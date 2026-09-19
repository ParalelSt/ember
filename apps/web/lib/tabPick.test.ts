import { describe, expect, it } from 'vitest';
import type { TabSummary } from '@/lib/tabSources';
import {
  BEST_BADGE,
  chooseTab,
  groupRows,
  MIN_SCORE_GAP,
  PICK_BADGE,
  rankTabs,
  sheetRows,
  sourceRank,
  statusLabel,
} from '@/lib/tabPick';

/** Which tab Ember draws (docs/tabs-v3.md stage 7) and how the Source sheet
 *  lists them (stage 6). Pure: every case here is rows in, rows out. */

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

const timing = (confidence: number) => ({ offsetMs: 1350, bpm: 100, confidence, bars: [] });

const songsterr = (id: string, confidence?: number) =>
  tab({
    id,
    kind: 'fetched',
    addedBy: null,
    title: 'Copper Sky',
    source: {
      site: 'songsterr',
      siteLabel: 'Songsterr',
      url: 'https://www.songsterr.com/a/wsa/x',
      part: 'multi',
      instruments: ['Rhythm Guitar', 'Bass'],
      version: 1,
      rating: null,
      votes: null,
    },
    ...(confidence === undefined ? {} : { timing: timing(confidence) }),
  });

const ug = (id: string, confidence?: number, over: Partial<TabSummary> = {}) =>
  tab({
    id,
    kind: 'fetched',
    addedBy: null,
    source: {
      site: 'ug',
      siteLabel: 'Ultimate Guitar',
      url: 'https://tabs.ultimate-guitar.com/tab/c/copper-sky-tabs-1',
      part: 'guitar',
      version: 2,
      rating: 4.7,
      votes: 512,
    },
    ...(confidence === undefined ? {} : { timing: timing(confidence) }),
    ...over,
  });

const pasted = (id: string, confidence?: number) =>
  tab({ id, kind: 'pasted', format: 'alphatex', ...(confidence === undefined ? {} : { timing: timing(confidence) }) });

const generated = (id: string, confidence?: number) =>
  tab({ id, kind: 'generated', addedBy: null, format: 'alphatex', ...(confidence === undefined ? {} : { timing: timing(confidence) }) });

describe('sourceRank', () => {
  it('is file, Songsterr, Ultimate Guitar, pasted, generated', () => {
    const order = [tab({ id: 'f' }), songsterr('s'), ug('u'), pasted('p'), generated('g')];
    expect(order.map(sourceRank)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('the tab Ember draws', () => {
  it('takes the highest confidence when the difference is real', () => {
    const tabs = [songsterr('s', 0.6), ug('u', 0.92)];
    expect(chooseTab(tabs, null).tab?.id).toBe('u');
    expect(rankTabs(tabs).map((t) => t.id)).toEqual(['u', 's']);
  });

  it('breaks a tie by source: Songsterr over Ultimate Guitar', () => {
    expect(chooseTab([ug('u', 0.9), songsterr('s', 0.9)], null).tab?.id).toBe('s');
  });

  it('a barely better score does not take the better source’s place', () => {
    // Four points ahead: inside the gap, so the source decides.
    expect(chooseTab([songsterr('s', 0.86), ug('u', 0.9)], null).tab?.id).toBe('s');
    // Six points ahead: past the gap, so the score decides.
    expect(chooseTab([songsterr('s', 0.86), ug('u', 0.92)], null).tab?.id).toBe('u');
    expect(MIN_SCORE_GAP).toBe(0.05);
  });

  it('a tab that could not be lined up confidently scores nothing', () => {
    // 0.4 is under LINED_UP_CONFIDENCE: the tab draws from the top, so its
    // number says nothing and the better source wins.
    expect(chooseTab([pasted('p', 0.4), tab({ id: 'f' })], null).tab?.id).toBe('f');
  });

  it('with nothing lined up it is the best source, file first', () => {
    const tabs = [generated('g'), pasted('p'), ug('u'), songsterr('s'), tab({ id: 'f' })];
    expect(rankTabs(tabs).map((t) => t.id)).toEqual(['f', 's', 'u', 'p', 'g']);
    expect(chooseTab(tabs, null).reason).toBe('the best source for this song, not lined up yet');
  });

  it('a listener’s own pick wins over every score', () => {
    const tabs = [songsterr('s', 0.94), generated('g')];
    const choice = chooseTab(tabs, 'g');
    expect(choice.tab?.id).toBe('g');
    expect(choice.byUser).toBe(true);
    expect(choice.reason).toBe('your pick');
  });

  it('a pick that is gone falls back to the best match', () => {
    const choice = chooseTab([songsterr('s', 0.94), ug('u', 0.6)], 'deleted');
    expect(choice.tab?.id).toBe('s');
    expect(choice.byUser).toBe(false);
    expect(choice.reason).toBe('best match, lined up 94%');
  });

  it('says so when there is one tab, and nothing when there are none', () => {
    expect(chooseTab([songsterr('s', 0.94)], null).reason).toBe('the only tab for this song');
    expect(chooseTab([], null)).toEqual({ tab: null, reason: '', byUser: false });
  });

  it('keeps the order it was given when everything else is equal', () => {
    const tabs = [ug('a', 0.9), ug('b', 0.9)];
    expect(rankTabs(tabs).map((t) => t.id)).toEqual(['a', 'b']);
    expect(rankTabs([...tabs].reverse()).map((t) => t.id)).toEqual(['b', 'a']);
  });
});

describe('statusLabel', () => {
  it('reads the confidence, or says it is not lined up', () => {
    expect(statusLabel(songsterr('s', 0.94))).toBe('Lined up 94%');
    expect(statusLabel(songsterr('s', 0.41))).toBe('Not lined up yet');
    expect(statusLabel(songsterr('s'))).toBe('Not lined up yet');
    expect(statusLabel(songsterr('s'), true)).toBe('Lining it up…');
  });
});

describe('the Source sheet’s rows', () => {
  it('names every source type', () => {
    const rows = sheetRows([
      tab({ id: 'f' }),
      tab({ id: 'x', format: 'musicxml', ext: '.musicxml' }),
      songsterr('s'),
      ug('u'),
      ug('b', undefined, { id: 'b', source: { ...ug('b').source!, part: 'bass', version: 1 } }),
      pasted('p'),
      generated('g'),
    ]);
    expect(rows.map((r) => r.type)).toEqual([
      'Guitar Pro file',
      'MusicXML file',
      'Tab with rhythm',
      'Text tab',
      'Bass tab',
      'Pasted text tab',
      'Generated, rough',
    ]);
  });

  it('carries the site, the rating, the instruments and who added it', () => {
    const rows = sheetRows([songsterr('s', 0.94), ug('u'), pasted('p', 0.7)]);
    const by = (id: string) => rows.find((r) => r.id === id)!;
    // Best first, then the rest by how well they matched.
    expect(rows.map((r) => r.id)).toEqual(['s', 'p', 'u']);
    const [ss, uu, pp] = [by('s'), by('u'), by('p')];
    expect(ss).toMatchObject({
      group: 'songsterr',
      groupLabel: 'Songsterr',
      instruments: ['Rhythm Guitar', 'Bass'],
      rating: '',
      confidence: 94,
      linedUp: true,
      status: 'Lined up 94%',
      badge: BEST_BADGE,
      addedBy: null,
      drawn: true,
    });
    expect(uu).toMatchObject({
      group: 'ug',
      groupLabel: 'Ultimate Guitar',
      name: 'Copper Sky (ver 2)',
      rating: '★ 4.7 (512 votes)',
      instruments: ['Guitar'],
      confidence: null,
      status: 'Not lined up yet',
      badge: null,
    });
    expect(pp).toMatchObject({ group: 'server', groupLabel: 'On this server', addedBy: 'pasted by Mira', confidence: 70 });
  });

  it('marks the listener’s own pick instead of the best match', () => {
    const rows = sheetRows([songsterr('s', 0.94), ug('u')], { chosenId: 'u' });
    expect(rows.find((r) => r.id === 'u')).toMatchObject({ badge: PICK_BADGE, drawn: true });
    expect(rows.find((r) => r.id === 's')?.badge).toBeNull();
  });

  it('badges nothing when the song has a single tab', () => {
    expect(sheetRows([songsterr('s', 0.94)])[0].badge).toBeNull();
  });

  it('shows a row as lining up while its job runs', () => {
    const rows = sheetRows([songsterr('s'), ug('u')], { aligning: ['u'] });
    expect(rows.map((r) => [r.id, r.status, r.aligning])).toEqual([
      ['s', 'Not lined up yet', false],
      ['u', 'Lining it up…', true],
    ]);
  });

  it('offers Delete only to whoever added the tab, or an admin', () => {
    const rows = sheetRows([
      tab({ id: 'mine', mine: true, canDelete: true }),
      tab({ id: 'theirs', canDelete: false }),
      // A fetched row has no uploader, so canDelete is an admin's alone
      // (lib/tabStore.ts): the sheet just follows the row.
      ug('fetched-admin', undefined, { canDelete: true }),
      generated('generated:upload:song1'),
    ]);
    expect(rows.map((r) => [r.id, r.canDelete])).toEqual([
      ['mine', true],
      ['theirs', false],
      ['fetched-admin', true],
      ['generated:upload:song1', false],
    ]);
  });

  it('offers Line it up on every real row, never on a generated stand-in', () => {
    const rows = sheetRows([tab({ id: 'f' }), songsterr('s'), generated('generated:upload:song1')]);
    expect(rows.map((r) => [r.id, r.canLineUp])).toEqual([
      ['f', true],
      ['s', true],
      ['generated:upload:song1', false],
    ]);
  });

  it('groups the rows in the order they are listed in', () => {
    const groups = groupRows(sheetRows([ug('u'), tab({ id: 'f' }), songsterr('s'), pasted('p')]));
    expect(groups.map((g) => [g.group, g.rows.map((r) => r.id)])).toEqual([
      // The pasted tab joins the server group the file opened, not a
      // second one further down.
      ['server', ['f', 'p']],
      ['songsterr', ['s']],
      ['ug', ['u']],
    ]);
  });
});
