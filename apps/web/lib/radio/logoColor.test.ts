import { describe, expect, it } from 'vitest';
import {
  DARK_LOGO_TILE,
  MAX_TILE_LUMINANCE,
  fallbackTileColor,
  logoColor,
  luminance,
  stationInitials,
  stationTileColor,
  tileColor,
  type Rgb,
} from './logoColor';

/** RGBA pixels: `n` of each [r, g, b, a]. */
function pixels(...runs: [number, [number, number, number, number]][]): Uint8ClampedArray {
  const out: number[] = [];
  for (const [n, px] of runs) for (let i = 0; i < n; i++) out.push(...px);
  return new Uint8ClampedArray(out);
}

const rgbOf = (css: string): Rgb => css.match(/\d+/g)!.slice(0, 3).map(Number) as unknown as Rgb;

describe('logoColor', () => {
  it('finds the main colour, ignoring see-through, near white and near black pixels', () => {
    const c = logoColor(pixels([50, [200, 20, 30, 255]], [30, [10, 90, 200, 255]], [200, [255, 255, 255, 255]], [100, [0, 0, 0, 255]], [400, [0, 200, 0, 0]]));
    expect(c).toEqual({ kind: 'color', rgb: [200, 20, 30] });
  });

  it('averages the pixels of the winning colour', () => {
    expect(logoColor(pixels([10, [200, 20, 30, 255]], [10, [204, 24, 28, 255]]))).toEqual({ kind: 'color', rgb: [202, 22, 29] });
  });

  it('says a black and white logo is light or dark, not coloured by a few stray pixels', () => {
    expect(logoColor(pixels([100, [250, 250, 250, 255]], [2, [200, 0, 0, 255]]))).toEqual({ kind: 'light' });
    expect(logoColor(pixels([100, [5, 5, 5, 255]], [20, [250, 250, 250, 255]]))).toEqual({ kind: 'dark' });
  });

  it('has nothing to say about a logo that shows nothing', () => {
    expect(logoColor(pixels([20, [255, 0, 0, 0]]))).toBeNull();
    expect(logoColor(new Uint8ClampedArray())).toBeNull();
  });
});

describe('tileColor', () => {
  it('keeps a dark or middling colour as it is', () => {
    expect(tileColor([30, 60, 140])).toBe('rgb(30 60 140)');
  });

  it('darkens a very light colour a little, keeping its hue', () => {
    const pale: Rgb = [250, 230, 120];
    const out = rgbOf(tileColor(pale));
    expect(luminance(out)).toBeLessThanOrEqual(MAX_TILE_LUMINANCE + 0.01);
    expect(luminance(out)).toBeGreaterThan(MAX_TILE_LUMINANCE - 0.05);
    expect(out[0]).toBeGreaterThan(out[1]);
    expect(out[1]).toBeGreaterThan(out[2]);
  });
});

describe('fallbackTileColor', () => {
  it('is steady for a station and differs between stations', () => {
    const a = '00000000-0000-4000-8000-000000000001';
    const b = '00000000-0000-4000-8000-000000000002';
    expect(fallbackTileColor(a)).toBe(fallbackTileColor(a));
    expect(fallbackTileColor(a)).not.toBe(fallbackTileColor(b));
    expect(fallbackTileColor(a)).toMatch(/^hsl\(\d+ 30% 34%\)$/);
  });
});

describe('stationTileColor', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  it('uses the logo colour, a pale grey behind a black logo, and the steady colour otherwise', () => {
    expect(stationTileColor(id, { kind: 'color', rgb: [30, 60, 140] })).toBe('rgb(30 60 140)');
    expect(stationTileColor(id, { kind: 'dark' })).toBe(DARK_LOGO_TILE);
    expect(stationTileColor(id, { kind: 'light' })).toBe(fallbackTileColor(id));
    expect(stationTileColor(id, null)).toBe(fallbackTileColor(id));
  });
});

describe('stationInitials', () => {
  it('takes up to two initials', () => {
    expect(stationInitials('Radio Sljeme')).toBe('RS');
    expect(stationInitials('Otvoreni')).toBe('O');
    expect(stationInitials('HR 2 Program')).toBe('H2');
    expect(stationInitials('narodni radio - zagreb')).toBe('NR');
    expect(stationInitials('*** !!!')).toBe('');
  });
});
