import { describe, expect, it, vi } from 'vitest';
import { castHandover, gateEvents, localHandover } from './castSwitch';
import { makeFakeEvents } from '@/test-utils/fakeBackend';

describe('castHandover', () => {
  it('a new session takes the song from where it is, playing if it was', () => {
    expect(castHandover({ localTime: 61.5, localPaused: false, resumed: false, remote: null })).toEqual({ startAt: 61.5, autoplay: true });
    expect(castHandover({ localTime: 10, localPaused: true, resumed: false, remote: null })).toEqual({ startAt: 10, autoplay: false });
  });

  it('a joined session follows the TV (a reload must not pause the room)', () => {
    expect(castHandover({
      localTime: 5, localPaused: true, resumed: true,
      remote: { state: 'playing', time: 120, duration: 200, idleReason: null },
    })).toEqual({ startAt: 120, autoplay: true });
    expect(castHandover({
      localTime: 5, localPaused: false, resumed: true,
      remote: { state: 'paused', time: 90, duration: 200, idleReason: null },
    })).toEqual({ startAt: 90, autoplay: false });
  });

  it('a joined session with nothing playing on the TV takes the page\'s song', () => {
    expect(castHandover({
      localTime: 33, localPaused: false, resumed: true,
      remote: { state: 'idle', time: 0, duration: 0, idleReason: 'finished' },
    })).toEqual({ startAt: 33, autoplay: true });
  });

  it('never a negative or missing position', () => {
    expect(castHandover({ localTime: NaN, localPaused: true, resumed: false, remote: null }).startAt).toBe(0);
    expect(castHandover({ localTime: -4, localPaused: true, resumed: false, remote: null }).startAt).toBe(0);
  });
});

describe('localHandover', () => {
  it('comes back paused where the TV was', () => {
    expect(localHandover(95)).toEqual({ startAt: 95, autoplay: false });
    expect(localHandover(NaN)).toEqual({ startAt: 0, autoplay: false });
  });
});

describe('gateEvents', () => {
  it('passes events on only while live', () => {
    const events = makeFakeEvents();
    let live = true;
    const gated = gateEvents(events, () => live);
    gated.onTime(3);
    live = false;
    gated.onTime(4);
    gated.onPause();
    gated.onError();
    expect(events.onTime).toHaveBeenCalledTimes(1);
    expect(events.onPause).not.toHaveBeenCalled();
    expect(events.onError).not.toHaveBeenCalled();
  });

  it('keeps optional callbacks optional', () => {
    const events = { ...makeFakeEvents(), onQueueIndex: vi.fn() };
    const gated = gateEvents(events, () => true);
    expect(gated.onQueueReplaced).toBeUndefined();
    gated.onQueueIndex?.(2);
    expect(events.onQueueIndex).toHaveBeenCalledWith(2);
  });
});
