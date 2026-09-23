import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { autoFill, derive, emberForeground, schemeOf, THEME_VARS } from '@/lib/theme/derive';
import { parseOklch, type Oklch } from '@/lib/theme/oklch';
import { EMBER_INPUTS, PRESET_BY_ID } from '@/lib/theme/presets';
import type { ThemeInputs } from '@/lib/theme/model';

/** The `:root` block of app/globals.css as name -> value, with
 *  `var(--x)` references resolved against the same block. */
function rootVars(): Record<string, string> {
  const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8');
  const block = /(?:^|\n):root\s*\{([\s\S]*?)\n\}/.exec(css)![1]!.replace(/\/\*[\s\S]*?\*\//g, '');
  const vars: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]!] = m[2]!.trim();
  const resolve = (v: string): string => {
    const ref = /^var\((--[\w-]+)\)$/.exec(v);
    return ref ? resolve(vars[ref[1]!]!) : v;
  };
  return Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, resolve(v)]));
}

function expectSameColour(actual: string, expected: string, name: string) {
  const a = parseOklch(actual);
  const e = parseOklch(expected);
  expect(a, `${name}: ${actual}`).not.toBeNull();
  expect(e, `${name} in globals.css: ${expected}`).not.toBeNull();
  expect(a!.color[0], `${name} L`).toBeCloseTo(e!.color[0], 3);
  expect(a!.color[1], `${name} C`).toBeCloseTo(e!.color[1], 3);
  expect(Math.round(a!.color[2]), `${name} H`).toBe(Math.round(e!.color[2]));
  expect(a!.alphaPct, `${name} alpha`).toBe(e!.alphaPct);
}

const nums = (css: string) => parseOklch(css)!.color;

describe('derive(Ember)', () => {
  const root = rootVars();
  const { vars, scheme } = derive(EMBER_INPUTS);

  it('covers every colour variable in globals.css :root, and nothing else', () => {
    const colourNames = Object.keys(root).filter((k) => parseOklch(root[k]!));
    expect([...colourNames].sort()).toEqual([...THEME_VARS].sort());
  });

  it.each(THEME_VARS.map((name) => [name]))('reproduces %s from globals.css', (name) => {
    expectSameColour(vars[name], root[name]!, name);
  });

  it('is a dark scheme', () => {
    expect(scheme).toBe('dark');
  });
});

describe('derive rules (plan section 1b)', () => {
  const inputs: ThemeInputs = {
    background: [0.3, 0.02, 100],
    surface: [0.4, 0.05, 200],
    text: [0.9, 0.01, 50],
    mutedText: [0.6, 0.02, 60],
    accent: [0.5, 0.2, 300],
    accentHover: [0.6, 0.15, 300],
    border: [0.9, 0, 0],
    sidebar: [0.25, 0.03, 120],
  };
  const { vars } = derive(inputs);

  it('copies text to every *-foreground and --primary', () => {
    for (const name of [
      '--foreground',
      '--card-foreground',
      '--popover-foreground',
      '--primary',
      '--secondary-foreground',
      '--accent-foreground',
      '--sidebar-primary-foreground',
      '--sidebar-accent-foreground',
    ] as const) {
      expect(vars[name]).toBe('oklch(0.9 0.01 50)');
    }
  });

  it('steps the surface for cards, hover rows, popovers and the shadcn accent', () => {
    expect(vars['--surface']).toBe('oklch(0.4 0.05 200)');
    expect(vars['--card']).toBe('oklch(0.4 0.05 200)');
    expect(vars['--surface-2']).toBe('oklch(0.44 0.05 200)');
    expect(vars['--muted']).toBe('oklch(0.44 0.05 200)');
    expect(vars['--popover']).toBe('oklch(0.42 0.06 200)');
    expect(vars['--secondary']).toBe('oklch(0.46 0.05 200)');
    expect(vars['--accent']).toBe('oklch(0.5 0.05 200)');
  });

  it('derives the rest from background, muted text, border, accent and sidebar', () => {
    expect(vars['--background']).toBe('oklch(0.3 0.02 100)');
    expect(vars['--primary-foreground']).toBe('oklch(0.32 0.02 100)');
    expect(vars['--muted-foreground']).toBe('oklch(0.6 0.02 60)');
    expect(vars['--border']).toBe('oklch(0.9 0 0 / 8%)');
    expect(vars['--input']).toBe('oklch(0.9 0 0 / 12%)');
    expect(vars['--sidebar-border']).toBe('oklch(0.9 0 0 / 6%)');
    for (const name of ['--ember', '--ring', '--sidebar-primary', '--sidebar-ring', '--cover-from'] as const) {
      expect(vars[name]).toBe('oklch(0.5 0.2 300)');
    }
    expect(vars['--ember-soft']).toBe('oklch(0.6 0.15 300)');
    expect(vars['--cover-to']).toBe('oklch(0.3 0.15 300)');
    expect(vars['--sidebar']).toBe('oklch(0.25 0.03 120)');
    expect(vars['--sidebar-foreground']).toBe('oklch(0.87 0.01 50)');
    expect(vars['--sidebar-accent']).toBe('oklch(0.34 0.03 120)');
  });

  it('keeps the danger red fixed whatever the accent', () => {
    expect(vars['--destructive']).toBe('oklch(0.65 0.22 25)');
    expect(derive(PRESET_BY_ID.forest.inputs).vars['--destructive']).toBe('oklch(0.65 0.22 25)');
  });

  it('clamps lightness steps at 0 and 1', () => {
    const bright = derive({ ...inputs, surface: [0.97, 0, 0], text: [0.01, 0, 0] }).vars;
    expect(bright['--accent']).toBe('oklch(1 0 0)');
    expect(bright['--sidebar-foreground']).toBe('oklch(0 0 0)');
  });
});

describe('scheme, --art and --ember-foreground', () => {
  it('calls a background under L 0.5 dark and anything else light', () => {
    expect(schemeOf([0.49, 0, 0])).toBe('dark');
    expect(schemeOf([0.5, 0, 0])).toBe('light');
  });

  it('puts artwork on black in a dark theme and a step below the background in a light one', () => {
    expect(derive(EMBER_INPUTS).vars['--art']).toBe('oklch(0 0 0)');
    const light = derive({ ...EMBER_INPUTS, background: [0.95, 0.01, 90], text: [0.2, 0, 0] });
    expect(light.scheme).toBe('light');
    expect(light.vars['--art']).toBe('oklch(0.87 0.01 90)');
  });

  it('keeps white on a dark enough accent and flips to the dark background on a light one', () => {
    expect(emberForeground(EMBER_INPUTS)).toEqual([1, 0, 0]);
    for (const id of ['forest', 'mono', 'midnight', 'nebula'] as const) {
      const preset = PRESET_BY_ID[id].inputs;
      expect(derive(preset).vars['--ember-foreground'], id).toBe(derive(preset).vars['--background']);
    }
  });

  it('uses the text when a light theme has a light accent (text is the darker one)', () => {
    const light: ThemeInputs = { ...EMBER_INPUTS, background: [0.97, 0, 0], text: [0.2, 0, 0], accent: [0.85, 0.1, 90] };
    expect(emberForeground(light)).toEqual([0.2, 0, 0]);
  });
});

describe('autoFill', () => {
  const close = (a: Oklch, b: Oklch) => {
    expect(Math.abs(a[0] - b[0])).toBeLessThanOrEqual(0.005);
    expect(a[1]).toBeCloseTo(b[1], 3);
    expect(a[2]).toBe(b[2]);
  };

  it("gives Ember's five More colours back from Ember's three Basics", () => {
    const { background, accent, text } = EMBER_INPUTS;
    const filled = autoFill({ background, accent, text });
    for (const key of ['surface', 'sidebar', 'mutedText', 'accentHover', 'border'] as const) {
      close(filled[key], EMBER_INPUTS[key]);
    }
  });

  it('keeps pinned colours and never lets a pin override a Basic', () => {
    const { background, accent, text } = EMBER_INPUTS;
    const filled = autoFill({ background, accent, text }, { surface: [0.5, 0.1, 10], background: [0.9, 0, 0] });
    expect(filled.surface).toEqual([0.5, 0.1, 10]);
    expect(filled.background).toEqual(background);
  });

  it('uses a black border for a light background', () => {
    expect(autoFill({ background: [0.95, 0, 0], accent: [0.5, 0.2, 25], text: [0.2, 0, 0] }).border).toEqual([0, 0, 0]);
  });

  it('follows the Basics: a new background moves surface and sidebar with it', () => {
    const filled = autoFill({ background: [0.3, 0.02, 150], accent: [0.7, 0.1, 80], text: [0.95, 0, 0] });
    expect(nums(derive(filled).vars['--surface'])).toEqual([0.34, 0.02, 150]);
    expect(filled.sidebar).toEqual([0.27, 0.02, 150]);
    expect(filled.accentHover[0]).toBeCloseTo(0.8, 5);
    expect(filled.accentHover[1]).toBeCloseTo(0.065, 5);
  });
});
