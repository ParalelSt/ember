import { describe, expect, it } from 'vitest';
import { checkTheme, isUnreadable, PAIRS, problems, type Finding, type PairId } from '@/lib/theme/guard';
import { contrast } from '@/lib/theme/oklch';
import { INPUT_KEYS, type ThemeInputs } from '@/lib/theme/model';
import { EMBER_INPUTS, PRESETS, PRESET_BY_ID } from '@/lib/theme/presets';

const finding = (inputs: ThemeInputs, pair: PairId): Finding => checkTheme(inputs).find((f) => f.pair === pair)!;
const MIDNIGHT = PRESET_BY_ID.midnight.inputs;

/** Inputs that put one pair at a given level, the rest of Ember intact. */
const CASES: Record<PairId, { warn: ThemeInputs; fail: ThemeInputs }> = {
  text: {
    warn: { ...EMBER_INPUTS, text: [0.62, 0, 0] },
    fail: { ...EMBER_INPUTS, text: [0.5, 0, 0] },
  },
  hover: {
    warn: { ...EMBER_INPUTS, surface: [0.5, 0.005, 260] },
    fail: { ...EMBER_INPUTS, surface: [0.62, 0.005, 260] },
  },
  menu: {
    warn: { ...EMBER_INPUTS, surface: [0.42, 0.005, 260] },
    fail: { ...EMBER_INPUTS, surface: [0.5, 0.005, 260] },
  },
  muted: {
    warn: { ...EMBER_INPUTS, mutedText: [0.55, 0.005, 260] },
    fail: { ...EMBER_INPUTS, mutedText: [0.4, 0.005, 260] },
  },
  button: {
    // No warn band for buttons: 3:1 or it fails.
    warn: EMBER_INPUTS,
    fail: { ...EMBER_INPUTS, accent: [0.74, 0.2, 25], background: [0.72, 0.005, 260] },
  },
  accent: {
    warn: { ...EMBER_INPUTS, accent: [0.55, 0.2, 25] },
    fail: { ...EMBER_INPUTS, accent: [0.4, 0.15, 25] },
  },
  sidebar: {
    warn: { ...EMBER_INPUTS, sidebar: [0.5, 0.005, 260] },
    fail: { ...EMBER_INPUTS, sidebar: [0.62, 0.005, 260] },
  },
};

describe('checkTheme', () => {
  it('rates all seven pairs, each with a plain label', () => {
    const all = checkTheme(EMBER_INPUTS);
    expect(all.map((f) => f.pair)).toEqual(['text', 'hover', 'menu', 'muted', 'button', 'accent', 'sidebar']);
    for (const f of all) expect(f.label).toMatch(/^[A-Z][a-z ]+$/);
  });

  it.each(PAIRS.filter((p) => p.id !== 'button').map((p) => [p.id]))('%s: warn and fail are reached at the thresholds', (id) => {
    const pair = id as PairId;
    expect(finding(CASES[pair].warn, pair).level).toBe('warn');
    expect(finding(CASES[pair].fail, pair).level).toBe('fail');
  });

  it('button text: 3:1 is ok with no warn band, under it fails', () => {
    const ember = finding(EMBER_INPUTS, 'button');
    expect(ember.level).toBe('ok');
    expect(ember.ratio).toBeCloseTo(3.2, 1);
    expect(finding(CASES.button.fail, 'button').level).toBe('fail');
  });

  it('rounds ratios to one decimal for display', () => {
    expect(finding(EMBER_INPUTS, 'text').ratio).toBe(18.3);
  });
});

describe('fix', () => {
  const cases = Object.entries(CASES).flatMap(([pair, c]) =>
    (['warn', 'fail'] as const).map((level) => [pair as PairId, level, c[level]] as const),
  );

  it.each(cases)('%s at %s: lifts the pair a level by moving one lightness only', (pair, level, inputs) => {
    const f = finding(inputs, pair);
    if (f.level === 'ok') return; // the button "warn" case is ok by design
    expect(f.fix, `${pair} ${level} has a fix`).toBeDefined();
    const fixed = finding(f.fix!, pair);
    if (level === 'warn') expect(fixed.level).toBe('ok');
    else expect(fixed.level).not.toBe('fail');
    const moved = INPUT_KEYS.filter((k) => JSON.stringify(f.fix![k]) !== JSON.stringify(inputs[k]));
    expect(moved).toEqual([PAIRS.find((p) => p.id === pair)!.moves]);
    const key = moved[0]!;
    expect(f.fix![key][1]).toBe(inputs[key][1]);
    expect(f.fix![key][2]).toBe(inputs[key][2]);
    const steps = Math.abs(f.fix![key][0] - inputs[key][0]) / 0.02;
    expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);
    expect(steps).toBeLessThanOrEqual(20);
  });

  it('moves the colour away from its partner', () => {
    const f = finding(CASES.text.fail, 'text');
    expect(f.fix!.text[0]).toBeGreaterThan(CASES.text.fail.text[0]);
    const s = finding(CASES.sidebar.fail, 'sidebar');
    expect(s.fix!.sidebar[0]).toBeLessThan(CASES.sidebar.fail.sidebar[0]);
  });

  it('offers no fix when 20 steps cannot get there, and none when ok', () => {
    // Text and background both mid grey, text can move at most 0.4.
    const hopeless: ThemeInputs = { ...EMBER_INPUTS, background: [0.5, 0, 0], text: [0.5, 0, 0] };
    const f = finding(hopeless, 'text');
    expect(f.level).toBe('fail');
    expect(contrast([0.9, 0, 0], hopeless.background)).toBeLessThan(4.5);
    expect(f.fix).toBeUndefined();
    expect(finding(EMBER_INPUTS, 'text').fix).toBeUndefined();
  });
});

describe('problems / isUnreadable', () => {
  it('lists only warn and fail, and a fail makes the theme unreadable', () => {
    expect(problems(MIDNIGHT)).toEqual([]);
    expect(isUnreadable(MIDNIGHT)).toBe(false);
    expect(problems(CASES.muted.warn).map((f) => f.pair)).toEqual(['muted']);
    expect(isUnreadable(CASES.muted.warn)).toBe(false);
    expect(isUnreadable(CASES.accent.fail)).toBe(true);
  });

  // bughunt N9: the guard checked text on surface+0.04 (the hover row) but
  // not surface+0.1 (--accent, the menu/dropdown highlight row derive.ts
  // actually paints), so a theme unreadable there sailed through as "ok".
  it('catches text on the menu-highlight row too, not just the hover row', () => {
    // A surface light enough to sink surface+0.1 below the fail threshold
    // while surface+0.04 alone is still fine, so only the missing pair
    // would have caught it.
    const badMenu: ThemeInputs = { ...EMBER_INPUTS, surface: [0.46, 0.005, 260] };
    expect(finding(badMenu, 'hover').level).not.toBe('fail');
    expect(finding(badMenu, 'menu').level).toBe('fail');
    expect(isUnreadable(badMenu)).toBe(true);
  });

  it('every preset stays fully readable, menu highlights included', () => {
    for (const preset of PRESETS) {
      expect(problems(preset.inputs), preset.id).toEqual([]);
      expect(isUnreadable(preset.inputs), preset.id).toBe(false);
    }
  });
});
