import { describe, expect, it } from 'vitest';
import { gainForMeasurement, MAX_GAIN_DB, MIN_GAIN_DB, TARGET_LUFS } from './loudnessPolicy';

// The same cases as tests/test_loudness.py (ComputeGainTest): the server
// recomputes stored gains here and must agree with loudness.py.

describe('gainForMeasurement', () => {
  it('leaves a typical song alone', () => {
    expect(TARGET_LUFS).toBe(-9);
    expect(gainForMeasurement(-9, 1)).toBe(0);
  });

  it('turns a loud master down to the target, a few dB at most', () => {
    expect(gainForMeasurement(-6, 2)).toBe(-3);
    expect(gainForMeasurement(-5, 1.2)).toBe(-4);
    expect(gainForMeasurement(-2, 3)).toBe(MIN_GAIN_DB);
    expect(MIN_GAIN_DB).toBe(-5);
    expect(gainForMeasurement(10, 2)).toBe(MIN_GAIN_DB);
  });

  it('boosts a quiet song only as far as its true peak allows', () => {
    expect(gainForMeasurement(-13, -8)).toBe(4);
    expect(gainForMeasurement(-13, -3)).toBe(2);
    expect(gainForMeasurement(-13, 0.3)).toBe(0);
    expect(gainForMeasurement(-40, -30)).toBe(MAX_GAIN_DB);
  });

  it('never boosts a song whose peak is unknown, but still cuts it', () => {
    expect(gainForMeasurement(-16, NaN)).toBe(0);
    expect(gainForMeasurement(-16, null)).toBe(0);
    expect(gainForMeasurement(-7, undefined)).toBe(-2);
  });

  it('is 0 for silence and for anything that is not a measurement', () => {
    expect(gainForMeasurement(-70, -Infinity)).toBe(0);
    expect(gainForMeasurement(-Infinity, -Infinity)).toBe(0);
    expect(gainForMeasurement(NaN, 0)).toBe(0);
    expect(gainForMeasurement(null, null)).toBe(0);
    expect(gainForMeasurement('-8', 0)).toBe(0);
    expect(Object.is(gainForMeasurement(-9.001, 5), 0)).toBe(true);
  });

  it('keeps a real library at the level it had (39 measured songs)', () => {
    const sample: Array<[number, number]> = [
      [-12.1, 1.0], [-7.6, 1.7], [-17.5, -6.6], [-21.1, -1.4], [-13.2, 0.4], [-9.8, 0.7],
      [-7.9, 1.7], [-8.0, 1.2], [-9.9, 0.7], [-21.7, -7.8], [-8.9, 1.0], [-9.6, 1.0],
      [-6.9, 2.0], [-9.6, 1.4], [-5.7, 3.4], [-10.3, 2.6], [-9.5, 0.7], [-8.8, 1.6],
      [-5.8, 2.5], [-13.8, -1.6], [-8.0, 2.6], [-10.7, 1.3], [-8.6, 1.0], [-7.9, 1.1],
      [-13.1, -0.4], [-7.5, 0.9], [-6.2, 1.6], [-13.6, 0.4], [-20.0, -0.9], [-10.6, -0.2],
      [-7.9, 3.1], [-11.8, -1.2], [-6.6, 2.1], [-9.2, 1.4], [-7.7, 1.7], [-6.2, 1.8],
      [-7.6, 2.2], [-12.8, -3.5], [-6.3, 2.5],
    ];
    const gains = sample.map(([l, p]) => gainForMeasurement(l, p)).sort((a, b) => a - b);
    expect(gains[Math.floor(gains.length / 2)]).toBe(0);
    expect(gains.reduce((a, b) => a + b, 0) / gains.length).toBeGreaterThan(-0.5);
    expect(gains[0]).toBeGreaterThanOrEqual(-3.5);
  });
});
