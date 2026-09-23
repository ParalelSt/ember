import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MOCK_MY_THEMES,
  MOCK_SHARED_THEMES,
  THEME_PRESETS,
  THEME_PRESET_BY_ID,
  formatOklch,
} from '@/components/library/options/themes/mock';

/** Compares two `oklch(l c h)` (or `oklch(l c h / a%)`) strings numerically,
 *  matching the plan's own tolerance ("L and C to 3 decimals, H to 0") so a
 *  trailing-zero difference like "0.2" vs "0.20" is not a failure. */
function oklchNums(s: string): number[] {
  return (s.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}
function expectSameOklch(a: string, b: string) {
  const [al, ac, ah] = oklchNums(a);
  const [bl, bc, bh] = oklchNums(b);
  expect(al).toBeCloseTo(bl, 3);
  expect(ac).toBeCloseTo(bc, 3);
  expect(ah).toBeCloseTo(bh, 0);
}

describe('THEME_PRESETS (mock)', () => {
  it('has exactly the five presets the plan names, in order', () => {
    expect(THEME_PRESETS.map((p) => p.id)).toEqual(['ember', 'midnight', 'forest', 'nebula', 'mono']);
  });

  it('Ember reproduces globals.css :root numerically (background, accent, text)', () => {
    const css = readFileSync(join(__dirname, '../../../../app/globals.css'), 'utf8');
    const rootBlock = css.split(':root {')[1]!.split('\n}')[0]!;
    const read = (name: string) => {
      const m = rootBlock.match(new RegExp(`--${name}:\\s*([^;]+);`));
      return m![1].trim();
    };
    const ember = THEME_PRESET_BY_ID.ember;
    expectSameOklch(formatOklch(ember.inputs.background), read('background'));
    expectSameOklch(formatOklch(ember.inputs.accent), read('ember'));
    expectSameOklch(formatOklch(ember.inputs.sidebar), read('sidebar'));
  });

  it('every preset carries the plan section 2 input values', () => {
    const table: Record<string, { background: string; accent: string }> = {
      ember: { background: 'oklch(0.16 0.005 260)', accent: 'oklch(0.68 0.2 25)' },
      midnight: { background: 'oklch(0.17 0.03 262)', accent: 'oklch(0.75 0.14 225)' },
      forest: { background: 'oklch(0.17 0.02 150)', accent: 'oklch(0.8 0.16 75)' },
      nebula: { background: 'oklch(0.16 0.03 300)', accent: 'oklch(0.72 0.19 320)' },
      mono: { background: 'oklch(0 0 0)', accent: 'oklch(0.97 0 0)' },
    };
    for (const preset of THEME_PRESETS) {
      expectSameOklch(formatOklch(preset.inputs.background), table[preset.id]!.background);
      expectSameOklch(formatOklch(preset.inputs.accent), table[preset.id]!.accent);
      expectSameOklch(preset.vars['--background']!, table[preset.id]!.background);
      expectSameOklch(preset.vars['--ember']!, table[preset.id]!.accent);
    }
  });

  it('Forest and Mono flip --ember-foreground to the background; the rest keep text', () => {
    expect(THEME_PRESET_BY_ID.forest.vars['--ember-foreground']).toBe(THEME_PRESET_BY_ID.forest.vars['--background']);
    expect(THEME_PRESET_BY_ID.mono.vars['--ember-foreground']).toBe(THEME_PRESET_BY_ID.mono.vars['--background']);
    expect(THEME_PRESET_BY_ID.ember.vars['--ember-foreground']).toBe(THEME_PRESET_BY_ID.ember.vars['--foreground']);
    expect(THEME_PRESET_BY_ID.midnight.vars['--ember-foreground']).toBe(THEME_PRESET_BY_ID.midnight.vars['--foreground']);
    expect(THEME_PRESET_BY_ID.nebula.vars['--ember-foreground']).toBe(THEME_PRESET_BY_ID.nebula.vars['--foreground']);
  });

  it('every preset drives a visibly different --background and --ember', () => {
    const backgrounds = new Set(THEME_PRESETS.map((p) => p.vars['--background']));
    const embers = new Set(THEME_PRESETS.map((p) => p.vars['--ember']));
    expect(backgrounds.size).toBe(THEME_PRESETS.length);
    expect(embers.size).toBe(THEME_PRESETS.length);
  });
});

describe('MOCK_MY_THEMES / MOCK_SHARED_THEMES', () => {
  it('has at least one saved theme already shared, and one not', () => {
    expect(MOCK_MY_THEMES.some((t) => t.shared)).toBe(true);
    expect(MOCK_MY_THEMES.some((t) => !t.shared)).toBe(true);
  });

  it('labels every shared theme with its owner’s name', () => {
    for (const t of MOCK_SHARED_THEMES) {
      expect(t.ownerName.length).toBeGreaterThan(0);
    }
  });
});
