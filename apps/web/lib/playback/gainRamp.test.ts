import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGainRamp, rampAt } from './gainRamp';

const db = (g: number) => 20 * Math.log10(g);

describe('rampAt', () => {
  it('fades evenly in dB from start to end', () => {
    expect(rampAt(1, 0.5, 0, 400)).toBe(1);
    expect(db(rampAt(1, 0.5, 200, 400))).toBeCloseTo(db(0.5) / 2, 6);
    expect(rampAt(1, 0.5, 400, 400)).toBe(0.5);
    expect(rampAt(1, 0.5, 9999, 400)).toBe(0.5);
  });

  it('no duration is a jump', () => {
    expect(rampAt(1, 2, 0, 0)).toBe(2);
  });

  it('fades to or from silence linearly', () => {
    expect(rampAt(0, 1, 100, 400)).toBeCloseTo(0.25, 6);
  });
});

describe('createGainRamp', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts at 1 and jumps when asked to', () => {
    const steps: number[] = [];
    const r = createGainRamp((v) => steps.push(v));
    expect(r.value()).toBe(1);
    r.set(0.5, 0);
    expect(r.value()).toBe(0.5);
    vi.advanceTimersByTime(1000);
    expect(steps).toEqual([]);
  });

  it('fades over the time given, in small steps, never overshooting', () => {
    const steps: number[] = [];
    const r = createGainRamp((v) => steps.push(v));
    r.set(0.5, 400);
    expect(r.value()).toBe(1);
    vi.advanceTimersByTime(200);
    expect(r.value()).toBeLessThan(1);
    expect(r.value()).toBeGreaterThan(0.5);
    vi.advanceTimersByTime(300);
    expect(r.value()).toBe(0.5);
    // Every step is small: at most ~0.5 dB for a 6 dB fade over 400 ms.
    let prev = 1;
    for (const s of steps) {
      expect(Math.abs(db(s) - db(prev))).toBeLessThan(0.6);
      expect(s).toBeLessThanOrEqual(prev);
      prev = s;
    }
    expect(steps.at(-1)).toBe(0.5);
    expect(steps.length).toBeGreaterThanOrEqual(15);
    // Done: no more ticks.
    const n = steps.length;
    vi.advanceTimersByTime(1000);
    expect(steps).toHaveLength(n);
  });

  it('asking for the same target again does not restart or cut the fade short', () => {
    const r = createGainRamp(() => {});
    r.set(2, 400);
    vi.advanceTimersByTime(200);
    const mid = r.value();
    r.set(2, 0);
    expect(r.value()).toBe(mid);
    vi.advanceTimersByTime(250);
    expect(r.value()).toBe(2);
  });

  it('a new target mid-fade fades on from where it got to', () => {
    const r = createGainRamp(() => {});
    r.set(0.5, 400);
    vi.advanceTimersByTime(200);
    const mid = r.value();
    r.set(1, 400);
    expect(r.value()).toBe(mid);
    vi.advanceTimersByTime(450);
    expect(r.value()).toBe(1);
  });

  it('a jump mid-fade lands at once and stops the fade', () => {
    const steps: number[] = [];
    const r = createGainRamp((v) => steps.push(v));
    r.set(0.5, 400);
    vi.advanceTimersByTime(100);
    r.set(1.5, 0);
    expect(r.value()).toBe(1.5);
    const n = steps.length;
    vi.advanceTimersByTime(1000);
    expect(steps).toHaveLength(n);
  });

  it('cancel stops where it is and ignores garbage', () => {
    const r = createGainRamp(() => {});
    r.set(NaN, 0);
    r.set(-1, 0);
    expect(r.value()).toBe(1);
    r.set(0.5, 400);
    vi.advanceTimersByTime(100);
    r.cancel();
    const v = r.value();
    vi.advanceTimersByTime(1000);
    expect(r.value()).toBe(v);
  });
});
