import { describe, expect, it } from 'vitest';
import {
  contrast,
  formatOklch,
  hexToOklch,
  isHex,
  oklchToHex,
  oklchToLinearRgb,
  parseOklch,
  roundOklch,
  type Oklch,
} from '@/lib/theme/oklch';

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const maxChannelDiff = (a: string, b: string) => Math.max(...channels(a).map((c, i) => Math.abs(c - channels(b)[i]!)));

/** A small seeded PRNG so the "random" colours are the same every run. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

describe('hexToOklch / oklchToHex', () => {
  it('reads white and black at the ends of lightness with no chroma', () => {
    const white = hexToOklch('#ffffff');
    expect(white[0]).toBeCloseTo(1, 4);
    expect(white[1]).toBeLessThan(0.0005);
    expect(hexToOklch('#000000')[0]).toBeCloseTo(0, 6);
    expect(roundOklch(white)).toEqual([1, 0, 0]);
  });

  it("puts Ember's red at about #fb5855", () => {
    const hex = oklchToHex([0.68, 0.2, 25]);
    expect(maxChannelDiff(hex, '#fb5855')).toBeLessThanOrEqual(2);
  });

  it('accepts #rgb, upper case and a missing #', () => {
    expect(oklchToHex(hexToOklch('#FFF'))).toBe('#ffffff');
    expect(oklchToHex(hexToOklch('fb5855'))).toBe('#fb5855');
    expect(isHex('#12ab9F')).toBe(true);
    expect(isHex('#12ab9')).toBe(false);
    expect(isHex('red')).toBe(false);
    expect(() => hexToOklch('nope')).toThrow();
  });

  it('round-trips every 8-bit grey exactly, raw and at storage precision', () => {
    for (let v = 0; v < 256; v++) {
      const hex = `#${v.toString(16).padStart(2, '0').repeat(3)}`;
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
      const stored = roundOklch(hexToOklch(hex));
      expect(stored[1]).toBe(0);
      expect(oklchToHex(stored)).toBe(hex);
    }
  });

  it('round-trips 200 random colours within 1 per channel at storage precision', () => {
    const rand = seeded(42);
    for (let i = 0; i < 200; i++) {
      const hex = `#${Math.floor(rand() * 0xffffff).toString(16).padStart(6, '0')}`;
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
      expect(maxChannelDiff(oklchToHex(roundOklch(hexToOklch(hex))), hex)).toBeLessThanOrEqual(1);
    }
  });

  it('maps an out-of-gamut colour into sRGB by lowering chroma, keeping lightness and hue', () => {
    const wild: Oklch = [0.7, 0.4, 150];
    expect(oklchToLinearRgb(wild).some((c) => c < 0 || c > 1)).toBe(true);
    const hex = oklchToHex(wild);
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    const [l, c, h] = hexToOklch(hex);
    expect(c).toBeLessThan(0.4);
    expect(l).toBeCloseTo(0.7, 1);
    expect(Math.abs(h - 150)).toBeLessThan(3);
  });

  it('clamps lightness outside 0..1 to white and black', () => {
    expect(oklchToHex([1.2, 0.1, 30])).toBe('#ffffff');
    expect(oklchToHex([-0.1, 0.1, 30])).toBe('#000000');
  });
});

describe('contrast', () => {
  it('is 21 for black on white, 1 for a colour on itself, and symmetric', () => {
    expect(contrast([1, 0, 0], [0, 0, 0])).toBeCloseTo(21, 5);
    expect(contrast([0.5, 0.1, 200], [0.5, 0.1, 200])).toBeCloseTo(1, 5);
    expect(contrast([0.3, 0.1, 20], [0.8, 0.05, 120])).toBeCloseTo(contrast([0.8, 0.05, 120], [0.3, 0.1, 20]), 10);
  });

  it("rates the plan's reference pairs", () => {
    // White on Ember's red, the app's button text today.
    expect(contrast([1, 0, 0], [0.68, 0.2, 25])).toBeCloseTo(3.2, 1);
    // Ember text on Ember background, and muted text on it.
    expect(contrast([0.98, 0, 0], [0.16, 0.005, 260])).toBeCloseTo(18, 0);
    expect(contrast([0.7, 0.005, 260], [0.16, 0.005, 260])).toBeCloseTo(7.4, 0);
  });

  it('composites a translucent colour over the other first', () => {
    expect(contrast([1, 0, 0], [0, 0, 0], 0)).toBeCloseTo(1, 5);
    expect(contrast([1, 0, 0], [0, 0, 0], 1)).toBeCloseTo(21, 5);
    const half = contrast([1, 0, 0], [0, 0, 0], 0.5);
    expect(half).toBeGreaterThan(1);
    expect(half).toBeLessThan(21);
  });
});

describe('formatOklch / parseOklch / roundOklch', () => {
  it('writes the CSS form, with alpha as a percentage', () => {
    expect(formatOklch([0.16, 0.005, 260])).toBe('oklch(0.16 0.005 260)');
    expect(formatOklch([1, 0, 0], 8)).toBe('oklch(1 0 0 / 8%)');
    expect(formatOklch([0.123456, 0.0123456, 264.4642])).toBe('oklch(0.1235 0.0123 264.46)');
  });

  it('stores a grey as C 0 and H 0, and wraps the hue into 0..360', () => {
    expect(roundOklch([0.5, 0.0004, 123])).toEqual([0.5, 0, 0]);
    expect(roundOklch([0.5, 0.1, 360])).toEqual([0.5, 0.1, 0]);
    expect(roundOklch([0.5, 0.1, -10])).toEqual([0.5, 0.1, 350]);
    expect(roundOklch([1.5, -1, 20])).toEqual([1, 0, 0]);
  });

  it("reads globals.css's forms back", () => {
    expect(parseOklch('oklch(0.16 0.005 260)')).toEqual({ color: [0.16, 0.005, 260] });
    expect(parseOklch('oklch(0.20 0.005 260)')).toEqual({ color: [0.2, 0.005, 260] });
    expect(parseOklch('oklch(1 0 0 / 8%)')).toEqual({ color: [1, 0, 0], alphaPct: 8 });
    expect(parseOklch('oklch(1 0 0 / 0.5)')).toEqual({ color: [1, 0, 0], alphaPct: 50 });
    expect(parseOklch(' oklch(50% 0.1 20deg) ')).toEqual({ color: [0.5, 0.1, 20] });
  });

  it('round-trips what it writes', () => {
    const color: Oklch = [0.1235, 0.0123, 264.46];
    expect(parseOklch(formatOklch(color))).toEqual({ color });
    expect(parseOklch(formatOklch([1, 0, 0], 12))).toEqual({ color: [1, 0, 0], alphaPct: 12 });
  });

  it('returns null for anything else', () => {
    for (const junk of ['', 'red', '#fff', 'var(--ember)', 'oklch(1 0)', 'oklch(a b c)', 'rgb(1 2 3)']) {
      expect(parseOklch(junk)).toBeNull();
    }
  });
});
