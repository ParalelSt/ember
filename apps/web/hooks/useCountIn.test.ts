import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCountIn } from './useCountIn';
import { countInPlan } from '@/lib/tabStage';
import { releaseClickContext } from '@/lib/metronome';

// The count-in before the pill starts the song: clicks on Web Audio, the
// beat for the pill, the start at the end, and nothing left when it is
// cancelled or the page goes.

const audio = { clicks: [] as { at: number; freq: number }[], silenced: 0 };
class FakeAudioContext {
  state = 'running';
  destination = {};
  currentTime = 10;
  resume() {
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
  createOscillator() {
    const o = { frequency: { value: 0 }, type: '', connect: () => {}, start: (at: number) => audio.clicks.push({ at, freq: o.frequency.value }), stop: () => {} };
    return o;
  }
  createGain() {
    return {
      gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
      connect: () => {},
      disconnect: () => {
        audio.silenced++;
      },
    };
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  audio.clicks = [];
  audio.silenced = 0;
  vi.stubGlobal('AudioContext', FakeAudioContext);
});
afterEach(() => {
  releaseClickContext();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useCountIn', () => {
  it('clicks one bar, accent first, shows each beat, then starts the song', () => {
    const done = vi.fn();
    const { result } = renderHook(() => useCountIn());
    act(() => result.current.start(countInPlan(1, { bpm: 120 }), done));
    expect(audio.clicks.map((c) => c.at - 10)).toEqual([0.05, 0.55, 1.05, 1.55].map((x) => expect.closeTo(x, 5)));
    expect(audio.clicks[0].freq).toBeGreaterThan(audio.clicks[1].freq);
    act(() => vi.advanceTimersByTime(60));
    expect(result.current.beat).toBe(0);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.beat).toBe(2);
    expect(done).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000));
    expect(done).toHaveBeenCalledTimes(1);
    expect(result.current.beat).toBeNull();
  });

  it('cancelled: the clicks go quiet and the song never starts', () => {
    const done = vi.fn();
    const { result } = renderHook(() => useCountIn());
    act(() => result.current.start(countInPlan(2, { bpm: 120 }), done));
    act(() => vi.advanceTimersByTime(700));
    act(() => result.current.cancel());
    expect(audio.silenced).toBe(8);
    expect(result.current.beat).toBeNull();
    act(() => vi.advanceTimersByTime(10_000));
    expect(done).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the page closing mid-count stops it too', () => {
    const done = vi.fn();
    const { result, unmount } = renderHook(() => useCountIn());
    act(() => result.current.start(countInPlan(1, { bpm: 90 }), done));
    unmount();
    act(() => vi.advanceTimersByTime(10_000));
    expect(done).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('nothing to count: the song starts at once', () => {
    const done = vi.fn();
    const { result } = renderHook(() => useCountIn());
    act(() => result.current.start(countInPlan(0, { bpm: 120 }), done));
    expect(done).toHaveBeenCalledTimes(1);
    expect(audio.clicks).toEqual([]);
  });
});
