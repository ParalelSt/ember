import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOverlayPlayer, OVERLAY_START_TIMEOUT_MS } from './overlayPlayer';
import { elementLevel, musicLevel, overlayLevel } from './mix';

/** Just enough of an <audio> element: play() resolves (or rejects) when the
 *  test says, and the test fires its events. */
class FakeAudio extends EventTarget {
  src = '';
  volume = 1;
  currentTime = 0;
  paused = true;
  loads = 0;
  removed = false;
  playMode: 'resolve' | 'reject' | 'hang' = 'resolve';
  play = vi.fn(() => {
    if (this.playMode === 'reject') return Promise.reject(new Error('NotAllowedError'));
    if (this.playMode === 'hang') return new Promise<void>(() => {});
    this.paused = false;
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  load = vi.fn(() => {
    this.loads += 1;
  });
  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }
  remove() {
    this.removed = true;
  }
  fire(type: string) {
    this.dispatchEvent(new Event(type));
  }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

let el: FakeAudio;
const make = () => createOverlayPlayer(() => el as unknown as HTMLAudioElement);

beforeEach(() => {
  vi.useFakeTimers();
  el = new FakeAudio();
});
afterEach(() => vi.useRealTimers());

describe('overlayPlayer', () => {
  it('plays the url at the given volume and settles on ended with the time heard', async () => {
    const o = make();
    const h = o.play('/api/x', { volume: 0.4, maxSec: 30 });
    expect(el.src).toBe('/api/x');
    expect(el.volume).toBe(0.4);
    expect(o.busy()).toBe(true);
    expect(await h.started).toBe(true);

    el.currentTime = 2.34;
    el.fire('ended');
    expect(await h.finished).toEqual({ reason: 'ended', playedSec: 2.3 });
    // Released: no src left, nothing playing, ready for the next one.
    expect(el.src).toBe('');
    expect(el.pause).toHaveBeenCalled();
    expect(el.loads).toBe(1);
    expect(o.busy()).toBe(false);
  });

  it('stops mid-way', async () => {
    const o = make();
    const h = o.play('/api/x', { volume: 1, maxSec: 30 });
    await flush();
    el.currentTime = 1.5;
    o.stop();
    expect(await h.finished).toEqual({ reason: 'stopped', playedSec: 1.5 });
    expect(el.paused).toBe(true);
    expect(o.busy()).toBe(false);
  });

  it('ends at maxSec from the first sound, whatever the file length', async () => {
    const o = make();
    const h = o.play('/api/x', { volume: 1, maxSec: 30 });
    await flush();
    el.currentTime = 29.9;
    vi.advanceTimersByTime(29_999);
    await flush();
    expect(o.busy()).toBe(true);
    el.currentTime = 31;
    vi.advanceTimersByTime(1);
    expect(await h.finished).toEqual({ reason: 'cap', playedSec: 30 });
  });

  it('reports a sound that never started: blocked, broken, or too slow', async () => {
    el.playMode = 'reject';
    let h = make().play('/api/x', { volume: 1, maxSec: 30 });
    expect(await h.started).toBe(false);
    expect((await h.finished).playedSec).toBe(0);

    el = new FakeAudio();
    el.playMode = 'hang';
    const o = make();
    h = o.play('/api/x', { volume: 1, maxSec: 30 });
    el.fire('error');
    expect(await h.started).toBe(false);
    expect((await h.finished).reason).toBe('error');

    h = o.play('/api/y', { volume: 1, maxSec: 30 });
    vi.advanceTimersByTime(OVERLAY_START_TIMEOUT_MS);
    expect(await h.started).toBe(false);
    expect(await h.finished).toEqual({ reason: 'error', playedSec: 0 });
  });

  it('a late "playing" after a stop changes nothing', async () => {
    el.playMode = 'hang';
    const o = make();
    const h = o.play('/api/x', { volume: 1, maxSec: 30 });
    o.stop();
    el.fire('playing');
    expect(await h.started).toBe(false);
    expect(o.busy()).toBe(false);
  });

  it('a new sound ends the one before it', async () => {
    const o = make();
    const first = o.play('/api/a', { volume: 1, maxSec: 30 });
    await flush();
    const second = o.play('/api/b', { volume: 0.5, maxSec: 30 });
    expect((await first.finished).reason).toBe('stopped');
    expect(el.src).toBe('/api/b');
    expect(await second.started).toBe(true);
    // The old listeners are gone: an ended now belongs to the second sound.
    el.fire('ended');
    expect((await second.finished).reason).toBe('ended');
  });

  it('follows volume changes only while something plays, clamped', async () => {
    const o = make();
    o.setVolume(0.2);
    expect(el.volume).toBe(1);
    o.play('/api/x', { volume: 0.5, maxSec: 30 });
    o.setVolume(3);
    expect(el.volume).toBe(1);
    o.setVolume(0.25);
    expect(el.volume).toBe(0.25);
  });

  it('destroy stops and removes the element', async () => {
    const o = make();
    const h = o.play('/api/x', { volume: 1, maxSec: 30 });
    o.destroy();
    expect((await h.finished).reason).toBe('stopped');
    expect(el.removed).toBe(true);
  });

  it('the real element sits hidden in the document', () => {
    vi.useRealTimers();
    const before = document.querySelectorAll('audio').length;
    const o = createOverlayPlayer();
    o.play('/api/x', { volume: 1, maxSec: 30 });
    const audios = document.querySelectorAll('audio');
    expect(audios.length).toBe(before + 1);
    const a = audios[audios.length - 1];
    expect(a.getAttribute('aria-hidden')).toBe('true');
    expect(a.style.opacity).toBe('0');
    o.destroy();
    expect(document.querySelectorAll('audio').length).toBe(before);
  });
});

describe('mix', () => {
  it('ducks the music through the slider value, and mute wins', () => {
    expect(musicLevel(0.8, false, 1)).toBe(0.8);
    expect(musicLevel(0.8, false, 0.3)).toBeCloseTo(0.24);
    expect(musicLevel(0.8, true, 0.3)).toBe(0);
    expect(musicLevel(2, false, 1)).toBe(1);
  });

  it('the sound is a share of what the music plays at, never louder', () => {
    // Same curve as the web backend: power 1.5, linear in party mode.
    expect(elementLevel(0.64, false, false)).toBeCloseTo(0.512);
    expect(elementLevel(0.64, false, true)).toBeCloseTo(0.64);
    expect(overlayLevel(1, 0.64, false, false)).toBeCloseTo(0.512);
    expect(overlayLevel(0.5, 0.64, false, false)).toBeCloseTo(0.256);
    expect(overlayLevel(5, 0.64, false, false)).toBeCloseTo(0.512);
    expect(overlayLevel(1, 0.64, true, false)).toBe(0);
    for (const v of [0, 0.1, 0.5, 0.85, 1]) {
      expect(overlayLevel(1, v, false, false)).toBeLessThanOrEqual(elementLevel(v, false, false));
    }
  });
});
