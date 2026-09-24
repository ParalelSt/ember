import { describe, expect, it } from 'vitest';
import {
  cleanThemeName,
  DEFAULT_THEME,
  INPUT_KEYS,
  isDefault,
  parseThemeDoc,
  resolveInputs,
  sameDoc,
  validateInputs,
  type ThemeDoc,
  type ThemeInputs,
} from '@/lib/theme/model';
import { EMBER_INPUTS, PRESET_BY_ID } from '@/lib/theme/presets';

const MIDNIGHT = PRESET_BY_ID.midnight.inputs;

describe('parseThemeDoc', () => {
  it('never throws, and anything that is not a v1 doc is the default', () => {
    for (const junk of [undefined, null, 0, 'ember', [], {}, { v: 2, preset: 'midnight' }, { preset: 'midnight' }, { v: '1' }]) {
      expect(parseThemeDoc(junk)).toEqual(DEFAULT_THEME);
    }
  });

  it('keeps a valid doc as it is', () => {
    const doc: ThemeDoc = { v: 1, preset: 'midnight', custom: MIDNIGHT, name: 'Night drive', themeId: 'abcdefghij12345' };
    expect(parseThemeDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    expect(parseThemeDoc({ v: 1, preset: 'forest' })).toEqual({ v: 1, preset: 'forest' });
  });

  it('falls back field by field', () => {
    expect(parseThemeDoc({ v: 1, preset: 'sunset' })).toEqual({ v: 1, preset: 'ember' });
    const doc = parseThemeDoc({
      v: 1,
      preset: 'midnight',
      custom: { ...MIDNIGHT, accent: [2, 0.1, 20], text: 'white', border: [1, 0] },
      name: 'x'.repeat(41),
      themeId: '../users',
    });
    expect(doc.preset).toBe('midnight');
    expect(doc.custom!.accent).toEqual(MIDNIGHT.accent);
    expect(doc.custom!.text).toEqual(MIDNIGHT.text);
    expect(doc.custom!.border).toEqual(MIDNIGHT.border);
    expect(doc.custom!.background).toEqual(MIDNIGHT.background);
    expect(doc.name).toBeUndefined();
    expect(doc.themeId).toBeUndefined();
  });

  it('rounds colours to storage precision', () => {
    const doc = parseThemeDoc({ v: 1, preset: 'ember', custom: { ...EMBER_INPUTS, accent: [0.123456, 0.0123456, 25.555] } });
    expect(doc.custom!.accent).toEqual([0.1235, 0.0123, 25.56]);
  });

  it('keeps a maximal doc under 450 bytes, since it travels in the pb_auth cookie', () => {
    const wide: ThemeInputs = Object.fromEntries(INPUT_KEYS.map((k) => [k, [0.1234, 0.1234, 359.99]])) as unknown as ThemeInputs;
    const doc = parseThemeDoc({ v: 1, preset: 'midnight', custom: wide, name: 'W'.repeat(40), themeId: 'abcdefghij12345' });
    expect(doc.name).toHaveLength(40);
    expect(new TextEncoder().encode(JSON.stringify(doc)).length).toBeLessThan(450);
  });
});

describe('validateInputs', () => {
  it('accepts all eight colours and rounds them', () => {
    const res = validateInputs({ ...MIDNIGHT, accent: [0.70004, 0.1, 225] });
    expect(res).toEqual({ ok: true, inputs: { ...MIDNIGHT, accent: [0.7, 0.1, 225] } });
  });

  it('names the first bad field instead of repairing it', () => {
    expect(validateInputs(null)).toEqual({ ok: false, error: 'inputs: expected an object with the eight colours' });
    const missing: Partial<ThemeInputs> = { ...MIDNIGHT };
    delete missing.sidebar;
    expect(validateInputs(missing)).toEqual({ ok: false, error: 'sidebar: missing' });
    expect(validateInputs({ ...MIDNIGHT, accent: [1.2, 0.1, 20] })).toEqual({ ok: false, error: 'accent: lightness out of range' });
    expect(validateInputs({ ...MIDNIGHT, text: [0.9, 0.5, 20] })).toEqual({ ok: false, error: 'text: chroma out of range' });
    expect(validateInputs({ ...MIDNIGHT, border: [0.9, 0.1, 400] })).toEqual({ ok: false, error: 'border: hue out of range' });
    expect(validateInputs({ ...MIDNIGHT, surface: [0.9, 0.1] })).toEqual({ ok: false, error: 'surface: expected [lightness, chroma, hue]' });
    expect(validateInputs({ ...MIDNIGHT, surface: [0.9, NaN, 3] })).toEqual({ ok: false, error: 'surface: expected [lightness, chroma, hue]' });
  });
});

describe('cleanThemeName', () => {
  it('trims and collapses whitespace, and refuses empty or long names', () => {
    expect(cleanThemeName('  Late \n shift ')).toBe('Late shift');
    expect(cleanThemeName('')).toBeNull();
    expect(cleanThemeName('   ')).toBeNull();
    expect(cleanThemeName('x'.repeat(40))).toHaveLength(40);
    expect(cleanThemeName('x'.repeat(41))).toBeNull();
    expect(cleanThemeName(42)).toBeNull();
  });
});

describe('resolveInputs / isDefault / sameDoc', () => {
  it("resolves a preset to its colours and a saved theme to its copy", () => {
    expect(resolveInputs({ v: 1, preset: 'forest' })).toBe(PRESET_BY_ID.forest.inputs);
    expect(resolveInputs({ v: 1, preset: 'forest', custom: MIDNIGHT })).toBe(MIDNIGHT);
  });

  it('is default exactly when the colours are Ember\'s', () => {
    expect(isDefault(DEFAULT_THEME)).toBe(true);
    expect(isDefault({ v: 1, preset: 'midnight', custom: { ...EMBER_INPUTS } })).toBe(true);
    expect(isDefault({ v: 1, preset: 'midnight' })).toBe(false);
    expect(isDefault({ v: 1, preset: 'ember', custom: { ...EMBER_INPUTS, accent: [0.68, 0.2, 26] } })).toBe(false);
  });

  it('compares docs by what they paint and how they are labelled', () => {
    expect(sameDoc({ v: 1, preset: 'forest' }, { v: 1, preset: 'forest' })).toBe(true);
    expect(sameDoc({ v: 1, preset: 'forest' }, { v: 1, preset: 'mono' })).toBe(false);
    expect(sameDoc({ v: 1, preset: 'ember', custom: MIDNIGHT, name: 'a' }, { v: 1, preset: 'ember', custom: MIDNIGHT, name: 'b' })).toBe(false);
  });
});
