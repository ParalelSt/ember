import { describe, expect, it } from 'vitest';
import {
  autoPreampDb,
  clampBand,
  design,
  EQ_BANDS,
  EQ_PRESETS,
  eqActive,
  highShelf,
  lowShelf,
  magnitudeDb,
  parseEq,
  peaking,
  presetFor,
  responseDb,
  type Biquad,
} from './eq';

const FS = 48000;

/** Runs the sections over `x` (transposed direct form II), the way the
 *  desktop and Android engines do. */
function filter(sections: Biquad[], x: number[], preampDb = 0): number[] {
  const g = Math.pow(10, preampDb / 20);
  const z = sections.map(() => [0, 0]);
  return x.map((v) => {
    let y = v * g;
    sections.forEach((c, i) => {
      const out = c.b0 * y + z[i][0];
      z[i][0] = c.b1 * y - c.a1 * out + z[i][1];
      z[i][1] = c.b2 * y - c.a2 * out;
      y = out;
    });
    return y;
  });
}
const sine = (f: number, secs: number, amp = 1) =>
  Array.from({ length: Math.round(FS * secs) }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / FS));
const rms = (x: number[]) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
const settled = (x: number[]) => x.slice(FS / 4);
const db = (r: number) => 20 * Math.log10(r);

describe('eq filter math', () => {
  it('a peaking band has its gain at its centre and none far away', () => {
    for (const g of [-12, -6, 3, 12]) {
      const c = peaking(FS, 910, 1, g);
      expect(magnitudeDb(c, FS, 910)).toBeCloseTo(g, 6);
      expect(Math.abs(magnitudeDb(c, FS, 20))).toBeLessThan(0.2);
      expect(Math.abs(magnitudeDb(c, FS, 18000))).toBeLessThan(0.2);
    }
  });

  it('shelves reach their gain on their side and half of it at the corner', () => {
    const low = lowShelf(FS, 60, 12);
    expect(magnitudeDb(low, FS, 5)).toBeCloseTo(12, 0);
    expect(magnitudeDb(low, FS, 60)).toBeCloseTo(6, 1);
    expect(Math.abs(magnitudeDb(low, FS, 5000))).toBeLessThan(0.05);
    const high = highShelf(FS, 14000, -9);
    expect(magnitudeDb(high, FS, 14000)).toBeCloseTo(-4.5, 1);
    expect(Math.abs(magnitudeDb(high, FS, 100))).toBeLessThan(0.05);
  });

  it('a zero band is the identity', () => {
    for (const c of design([0, 0, 0, 0, 0], FS)) expect(c).toEqual({ b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 });
  });

  it('the filters do to a real signal what the curve says', () => {
    const bands = [0, 0, 6, 0, 0];
    const sections = design(bands, FS);
    for (const f of [100, 910, 8000]) {
      const x = sine(f, 1, 0.25);
      const y = filter(sections, x);
      expect(db(rms(settled(y)) / rms(settled(x)))).toBeCloseTo(responseDb(sections, FS, f), 1);
    }
  });

  it('with the auto pre-amp a full-scale tone at a boosted band does not clip', () => {
    for (const p of EQ_PRESETS) {
      const sections = design(p.bands, FS);
      const pre = autoPreampDb(p.bands, FS);
      for (const f of EQ_BANDS) {
        if (f > FS / 2) continue;
        const peak = Math.max(...settled(filter(sections, sine(f, 0.6), pre)).map(Math.abs));
        expect(peak, `${p.id} at ${f} Hz`).toBeLessThanOrEqual(1.01);
      }
    }
  });
});

describe('autoPreampDb', () => {
  it('is 0 for flat and for pure cuts: it only makes room', () => {
    expect(autoPreampDb([0, 0, 0, 0, 0])).toBe(0);
    expect(autoPreampDb([-6, -6, -6, -6, -6])).toBe(0);
  });

  it('cancels a single boost', () => {
    expect(autoPreampDb([0, 0, 9, 0, 0])).toBeCloseTo(-9, 1);
  });

  it('covers overlapping boosts, which add up past either alone', () => {
    expect(autoPreampDb([12, 12, 0, 0, 0])).toBeLessThan(-12);
  });
});

describe('eq settings', () => {
  it('bands are held to -12..+12 in half dB steps', () => {
    expect(clampBand(20)).toBe(12);
    expect(clampBand(-20)).toBe(-12);
    expect(clampBand(2.26)).toBe(2.5);
    expect(clampBand(-0.1)).toBe(0);
    expect(Object.is(clampBand(-0.1), -0)).toBe(false);
    expect(clampBand('3')).toBe(0);
    expect(clampBand(Number.NaN)).toBe(0);
  });

  it('parseEq takes five numbers and a switch, nothing else', () => {
    expect(parseEq({ enabled: true, bands: [1, 2, 3, 4, 5] })).toEqual({ enabled: true, bands: [1, 2, 3, 4, 5] });
    expect(parseEq({ enabled: false, bands: [99, 0, 0, 0, 0], extra: 1 })).toEqual({
      enabled: false,
      bands: [12, 0, 0, 0, 0],
    });
    for (const bad of [null, [], 'x', { enabled: 1, bands: [0, 0, 0, 0, 0] }, { enabled: true, bands: [0] }]) {
      expect(parseEq(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('is active only when on and not flat', () => {
    expect(eqActive({ enabled: true, bands: [0, 0, 0, 0, 1] })).toBe(true);
    expect(eqActive({ enabled: false, bands: [0, 0, 0, 0, 1] })).toBe(false);
    expect(eqActive({ enabled: true, bands: [0, 0, 0, 0, 0] })).toBe(false);
  });

  it('has the seven presets, each a valid curve, and knows which one a curve is', () => {
    expect(EQ_PRESETS.map((p) => p.label)).toEqual([
      'Flat', 'Bass boost', 'Treble boost', 'Vocal', 'Acoustic', 'Electronic', 'Loudness',
    ]);
    for (const p of EQ_PRESETS) {
      expect(p.bands).toHaveLength(5);
      expect(p.bands.every((b) => clampBand(b) === b)).toBe(true);
      expect(presetFor(p.bands)).toBe(p.id);
    }
    expect(presetFor([1, 0, 0, 0, 0])).toBeNull();
  });
});
