import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebBackend } from './webBackend';
import { makeFakeEvents } from '@/test-utils/fakeBackend';

vi.mock('@/lib/logger/client', () => ({
  logger: { breadcrumb: vi.fn(), error: vi.fn() },
}));

/** Make the element's play() reject the way a browser does. */
function rejectPlayWith(name: string) {
  return vi
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockImplementation(() => Promise.reject(new DOMException('play() failed', name)));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('webBackend load(autoplay)', () => {
  it('does not report a pause when play() was aborted by a newer load', async () => {
    // A newer src replacing a pending play() rejects it with AbortError. That
    // is a load being superseded, not the listener pausing.
    rejectPlayWith('AbortError');
    const events = makeFakeEvents();
    const b = createWebBackend(events);
    b.load('/s/a', { autoplay: true });
    await vi.waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    await Promise.resolve();
    await Promise.resolve();
    expect(events.onPause).not.toHaveBeenCalled();
    b.destroy();
  });

  it('still reports a pause when the browser refuses to autoplay', async () => {
    rejectPlayWith('NotAllowedError');
    const events = makeFakeEvents();
    const b = createWebBackend(events);
    b.load('/s/a', { autoplay: true });
    await vi.waitFor(() => expect(events.onPause).toHaveBeenCalledTimes(1));
    b.destroy();
  });
});

describe('webBackend getBufferedToEnd', () => {
  function withElement(state: {
    src?: string;
    duration?: number;
    ranges?: Array<[number, number]>;
    networkState?: number;
    currentTime?: number;
  }) {
    const b = createWebBackend(makeFakeEvents());
    const a = document.querySelector('audio') as HTMLAudioElement;
    if (state.src !== undefined) a.src = state.src;
    const ranges = state.ranges ?? [];
    Object.defineProperty(a, 'duration', { configurable: true, get: () => state.duration ?? NaN });
    Object.defineProperty(a, 'currentTime', { configurable: true, get: () => state.currentTime ?? 0, set: () => {} });
    Object.defineProperty(a, 'networkState', { configurable: true, get: () => state.networkState ?? 1 });
    Object.defineProperty(a, 'buffered', {
      configurable: true,
      get: () => ({ length: ranges.length, start: (i: number) => ranges[i][0], end: (i: number) => ranges[i][1] }),
    });
    return b;
  }

  it('is null with nothing loaded or no known duration', () => {
    const empty = withElement({});
    expect(empty.getBufferedToEnd?.()).toBeNull();
    empty.destroy();
    const noDur = withElement({ src: 'http://h/s/a' });
    expect(noDur.getBufferedToEnd?.()).toBeNull();
    noDur.destroy();
  });

  it('is true for a local blob copy', () => {
    const b = withElement({ src: 'blob:http://h/x' });
    expect(b.getBufferedToEnd?.()).toBe(true);
    b.destroy();
  });

  it('is true once a range covers the playhead to the end', () => {
    const b = withElement({ src: 'http://h/s/a', duration: 200, ranges: [[0, 200]], currentTime: 30 });
    expect(b.getBufferedToEnd?.()).toBe(true);
    b.destroy();
  });

  it('is false while the browser is still fetching the rest', () => {
    const b = withElement({ src: 'http://h/s/a', duration: 200, ranges: [[0, 80]], networkState: 2 });
    expect(b.getBufferedToEnd?.()).toBe(false);
    b.destroy();
  });

  it('is null when the browser stopped buffering short of the end (it cannot tell)', () => {
    const b = withElement({ src: 'http://h/s/a', duration: 200, ranges: [[0, 80]], networkState: 1 });
    expect(b.getBufferedToEnd?.()).toBeNull();
    b.destroy();
  });
});

describe('webBackend seek', () => {
  it('seeks to the asked time while the element does not know the length yet', () => {
    // Right after a load the element's duration is NaN. Clamping to it sent
    // every early seek (the bar knows the length from the catalogue) to 0:00.
    vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(NaN);
    const events = makeFakeEvents();
    const b = createWebBackend(events);
    b.seek(90);
    expect(events.onTime).toHaveBeenLastCalledWith(90);
    b.destroy();
  });

  it('still clamps to a known length', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(200);
    const events = makeFakeEvents();
    const b = createWebBackend(events);
    b.seek(500);
    expect(events.onTime).toHaveBeenLastCalledWith(200);
    b.seek(-3);
    expect(events.onTime).toHaveBeenLastCalledWith(0);
    b.destroy();
  });
});

describe('webBackend setVolume with normalization', () => {
  const element = () => document.body.querySelector('audio') as HTMLAudioElement;

  it('multiplies the curved volume by the song gain', () => {
    const b = createWebBackend(makeFakeEvents());
    b.setVolume(0.64, { normGain: 0.5 });
    // 0.64^1.5 = 0.512, halved by a -6 dB song.
    expect(element().volume).toBeCloseTo(0.256, 5);
    b.destroy();
  });

  it('no gain, or a gain of 1, is the plain curve', () => {
    const b = createWebBackend(makeFakeEvents());
    b.setVolume(0.64);
    expect(element().volume).toBeCloseTo(0.512, 5);
    b.setVolume(0.64, { normGain: 1 });
    expect(element().volume).toBeCloseTo(0.512, 5);
    b.destroy();
  });

  it('a boost is capped at full volume', () => {
    const b = createWebBackend(makeFakeEvents());
    b.setVolume(1, { normGain: 2 });
    expect(element().volume).toBe(1);
    b.setVolume(0.25, { normGain: 2 });
    expect(element().volume).toBeCloseTo(0.25, 5);
    b.destroy();
  });

  it('party mode without Web Audio falls back to the element', () => {
    const b = createWebBackend(makeFakeEvents());
    b.setVolume(0.8, { gain: 2, normGain: 0.5 });
    expect(element().volume).toBeCloseTo(0.4, 5);
    b.destroy();
  });
});

describe('webBackend setRate (practice speed)', () => {
  it('slows the element with the pitch kept, and keeps the speed across a new src', () => {
    const b = createWebBackend(makeFakeEvents());
    const el = document.querySelector('audio') as HTMLAudioElement & { webkitPreservesPitch?: boolean };
    b.setRate!(0.75);
    expect(el.playbackRate).toBe(0.75);
    expect(el.defaultPlaybackRate).toBe(0.75);
    expect(el.preservesPitch).toBe(true);
    expect(el.webkitPreservesPitch).toBe(true);
    b.setRate!(1);
    expect(el.playbackRate).toBe(1);
    b.destroy();
  });

  it('refuses nonsense: zero, negative or NaN is full speed', () => {
    const b = createWebBackend(makeFakeEvents());
    const el = document.querySelector('audio') as HTMLAudioElement;
    b.setRate!(Number.NaN);
    expect(el.playbackRate).toBe(1);
    b.setRate!(-2);
    expect(el.playbackRate).toBe(1);
    b.setRate!(0.1);
    expect(el.playbackRate).toBe(0.25);
    b.destroy();
  });
});
