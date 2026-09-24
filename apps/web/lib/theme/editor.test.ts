import { describe, expect, it } from 'vitest';
import { applyChange, pinnedOf, refill, selectionOf, uniqueName } from '@/lib/theme/editor';
import { autoFill } from '@/lib/theme/derive';
import { PRESET_BY_ID, PRESETS } from '@/lib/theme/presets';
import type { SavedTheme, SharedTheme, ThemesList } from '@/lib/theme/saved';

const MIDNIGHT = PRESET_BY_ID.midnight.inputs;
const mine: SavedTheme = {
  id: 'aaaaaaaaaaaaaaa',
  name: 'Night drive',
  base: 'midnight',
  inputs: { ...MIDNIGHT, accent: [0.72, 0.16, 300] },
  shared: false,
  created: '',
  updated: '',
};
const theirs: SharedTheme = { id: 'bbbbbbbbbbbbbbb', name: 'Cold brew', base: 'nebula', inputs: PRESET_BY_ID.nebula.inputs, ownerName: 'Luka', updated: '' };
const list: ThemesList = { mine: [mine], shared: [theirs], cap: 20 };

describe('selectionOf', () => {
  it('a preset as is', () => {
    const sel = selectionOf({ v: 1, preset: 'forest' }, list);
    expect(sel).toMatchObject({ kind: 'preset', key: 'preset:forest', name: 'Forest', inputs: PRESET_BY_ID.forest.inputs });
  });

  it('one of mine, with the row as the truth', () => {
    const sel = selectionOf({ v: 1, preset: 'midnight', custom: MIDNIGHT, themeId: mine.id }, list);
    expect(sel).toMatchObject({ kind: 'mine', key: mine.id, name: 'Night drive', inputs: mine.inputs });
  });

  it('someone else\'s shared theme', () => {
    const sel = selectionOf({ v: 1, preset: 'nebula', custom: theirs.inputs, themeId: theirs.id }, list);
    expect(sel).toMatchObject({ kind: 'others', key: theirs.id });
  });

  it('pending while the list loads, loose once it has and the row is gone', () => {
    const doc = { v: 1 as const, preset: 'midnight' as const, custom: MIDNIGHT, name: 'Gone', themeId: 'ccccccccccccccc' };
    expect(selectionOf(doc, null).kind).toBe('pending');
    expect(selectionOf(doc, list)).toMatchObject({ kind: 'loose', name: 'Gone', inputs: MIDNIGHT });
  });
});

describe('pinnedOf', () => {
  it('Ember follows its own auto rules: nothing pinned', () => {
    expect([...pinnedOf(PRESET_BY_ID.ember.inputs)]).toEqual([]);
  });

  it('auto-filled inputs pin nothing; a hand-set More colour is pinned', () => {
    for (const p of PRESETS) expect([...pinnedOf(autoFill(p.inputs))]).toEqual([]);
    const inputs = { ...autoFill(MIDNIGHT), mutedText: [0.5, 0.1, 30] as const };
    expect([...pinnedOf(inputs)]).toEqual(['mutedText']);
  });
});

describe('applyChange', () => {
  it('a Basic re-fills every unpinned More colour and keeps the pinned ones', () => {
    const start = autoFill(MIDNIGHT);
    const pinned = new Set(['sidebar'] as const);
    const out = applyChange(start, pinned, 'background', [0.3, 0.03, 262]);
    expect(out.inputs.background).toEqual([0.3, 0.03, 262]);
    expect(out.inputs.surface[0]).toBeCloseTo(0.34, 5);
    expect(out.inputs.sidebar).toEqual(start.sidebar);
    expect([...out.pinned]).toEqual(['sidebar']);
  });

  it('a More colour becomes pinned', () => {
    const out = applyChange(autoFill(MIDNIGHT), new Set(), 'border', [0.5, 0, 0]);
    expect(out.inputs.border).toEqual([0.5, 0, 0]);
    expect([...out.pinned]).toEqual(['border']);
  });

  it('refill puts an unpinned row back on the auto rules', () => {
    const inputs = { ...autoFill(MIDNIGHT), surface: [0.5, 0.03, 262] as const };
    expect(refill(inputs, new Set()).surface).toEqual(autoFill(MIDNIGHT).surface);
  });
});

describe('uniqueName', () => {
  it('the name itself when free, else the first free number', () => {
    expect(uniqueName('My Midnight', [])).toBe('My Midnight');
    expect(uniqueName('My Midnight', ['my midnight', 'My Midnight 2'])).toBe('My Midnight 3');
  });

  it('stays within 40 characters', () => {
    const long = 'x'.repeat(45);
    expect(uniqueName(long, [])).toHaveLength(40);
    const second = uniqueName(long, ['x'.repeat(40)]);
    expect(second).toHaveLength(40);
    expect(second.endsWith(' 2')).toBe(true);
  });
});
