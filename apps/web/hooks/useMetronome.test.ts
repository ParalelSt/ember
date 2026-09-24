import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMetronome, type MetronomeOptions } from './useMetronome';
import { steadyBeats } from '@/lib/tabTimeline';

/** A fake AudioContext whose clock is the (fake) wall clock, recording
 *  when each oscillator is told to start. */
const audio = vi.hoisted(() => ({ starts: [] as { at: number; freq: number }[], made: 0 }));

class FakeAudioContext {
  state = 'running';
  destination = {};
  constructor() {
    audio.made++;
  }
  get currentTime() {
    return performance.now() / 1000;
  }
  resume() {
    return Promise.resolve();
  }
  createOscillator() {
    const osc = {
      frequency: { value: 0 },
      type: '',
      connect: () => {},
      start: (t: number) => audio.starts.push({ at: t, freq: osc.frequency.value }),
      stop: () => {},
    };
    return osc;
  }
  createGain() {
    return { gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: () => {} };
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance', 'Date'] });
  audio.starts = [];
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
});
afterEach(() => {
  vi.useRealTimers();
});

/** Beats every half second from the song's start (120 bpm, 4/4). */
const everyHalf: MetronomeOptions['beats'] = (from, to) => steadyBeats(0, 120, 4, from, to);

function run(opts: Partial<MetronomeOptions> = {}) {
  const base: MetronomeOptions = { on: true, running: true, position: 10, rate: 1, beats: everyHalf, ...opts };
  return renderHook((p: MetronomeOptions) => useMetronome(p), { initialProps: base });
}

/** Start times relative to when the hook started, rounded to ms. */
const startsFrom = (t0: number) => audio.starts.map((s) => Math.round((s.at - t0) * 1000));

describe('useMetronome', () => {
  it('clicks each beat once, on time, accenting the bar', () => {
    const t0 = performance.now() / 1000;
    run({ position: 9.9 });
    vi.advanceTimersByTime(1000);
    // Song 9.9 s at t0: beats at 10, 10.5 (and 11 is inside the last look ahead).
    expect(startsFrom(t0).slice(0, 2)).toEqual([100, 600]);
    expect(new Set(audio.starts.map((s) => s.at)).size).toBe(audio.starts.length);
    // 10 s is the first beat of a bar (every 2 s at 120 bpm in 4/4).
    expect(audio.starts[0].freq).toBeGreaterThan(audio.starts[1].freq);
  });

  it('at half speed the beats come half as often', () => {
    const t0 = performance.now() / 1000;
    const { rerender } = run({ position: 9.9, rate: 0.5 });
    vi.advanceTimersByTime(900);
    // The player reports where it got to: 0.45 s of song in 0.9 s.
    rerender({ on: true, running: true, position: 10.35, rate: 0.5, beats: everyHalf });
    vi.advanceTimersByTime(600);
    expect(startsFrom(t0).slice(0, 2)).toEqual([200, 1200]);
  });

  it('silent when off, paused, or with nothing to click', () => {
    const { rerender } = run({ on: false });
    vi.advanceTimersByTime(1000);
    rerender({ on: true, running: false, position: 10, rate: 1, beats: everyHalf });
    vi.advanceTimersByTime(1000);
    rerender({ on: true, running: true, position: 10, rate: 1, beats: () => [] });
    vi.advanceTimersByTime(1000);
    expect(audio.starts).toEqual([]);
  });

  it('a seek starts over from the new place', () => {
    const t0 = performance.now() / 1000;
    const { rerender } = run({ position: 9.9 });
    vi.advanceTimersByTime(300);
    const before = audio.starts.length;
    // Back to 3.95 s: the next beat is at 4 s, 50 ms away.
    rerender({ on: true, running: true, position: 3.95, rate: 1, beats: everyHalf });
    vi.advanceTimersByTime(100);
    const after = startsFrom(t0).slice(before);
    expect(after[0]).toBe(350);
  });

  it('a beat that throws is a silent beat', () => {
    run({ beats: () => { throw new Error('no tick lookup'); } });
    expect(() => vi.advanceTimersByTime(200)).not.toThrow();
    expect(audio.starts).toEqual([]);
  });
});
