import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePracticeLoop, type PracticeLoopOptions } from './usePracticeLoop';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

const SPAN = { startSec: 5, endSec: 10 };

function run(over: Partial<PracticeLoopOptions> = {}) {
  const seek = vi.fn();
  const base: PracticeLoopOptions = { span: SPAN, follows: true, running: true, position: 9.5, rate: 1, seek, ...over };
  const view = renderHook((p: PracticeLoopOptions) => usePracticeLoop(p), { initialProps: base });
  return { seek, base, ...view };
}

describe('usePracticeLoop', () => {
  it('goes back to the start as the playhead runs over the end', () => {
    const { seek } = run();
    vi.advanceTimersByTime(400);
    expect(seek).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(seek).toHaveBeenCalledTimes(1);
    expect(seek).toHaveBeenCalledWith(5);
    // And again five seconds later, from the start it jumped to.
    vi.advanceTimersByTime(900);
    expect(seek).toHaveBeenCalledTimes(1);
  });

  it('at half speed the end comes twice as late', () => {
    const { seek, rerender, base } = run({ rate: 0.5 });
    vi.advanceTimersByTime(900);
    expect(seek).not.toHaveBeenCalled();
    // The player reports where it got to.
    rerender({ ...base, rate: 0.5, position: 9.95 });
    vi.advanceTimersByTime(150);
    expect(seek).toHaveBeenCalledWith(5);
  });

  it('turned on with the playhead outside the loop, it starts from the top', () => {
    const { seek } = run({ position: 42 });
    expect(seek).toHaveBeenCalledWith(5);
  });

  it('a seek elsewhere is the listener’s: left alone', () => {
    const { seek, rerender, base } = run({ position: 7 });
    rerender({ ...base, position: 30 });
    vi.advanceTimersByTime(1000);
    expect(seek).not.toHaveBeenCalled();
  });

  it('never seeks another song, and does nothing without a loop or while paused', () => {
    expect(run({ follows: false, running: false, position: 42 }).seek).not.toHaveBeenCalled();
    const off = run({ span: null });
    vi.advanceTimersByTime(2000);
    expect(off.seek).not.toHaveBeenCalled();
    const paused = run({ running: false, position: 9.99 });
    vi.advanceTimersByTime(2000);
    expect(paused.seek).not.toHaveBeenCalled();
  });
});
