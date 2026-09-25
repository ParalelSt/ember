import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAndroidBackend, OVERLAY_END_GRACE_MS } from './androidBackend';
import { makeFakeEvents } from '@/test-utils/fakeBackend';

// The native prank overlay as the web side sees it: calls forwarded to the
// EmberPlayer plugin, its `overlay` event mapped back onto the handle, and an
// app build without the methods left without them.

const noise = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock('@/lib/logger/client', () => ({ logger: { error: noise.log, info: noise.log, warn: noise.log } }));

type Listener = (d: unknown) => void;

function installPlugin(withOverlay: boolean) {
  const listeners = new Map<string, Listener>();
  let startResolve: (r: { started: boolean; reason?: string }) => void = () => {};
  const plugin: Record<string, unknown> = {
    addListener: vi.fn((event: string, cb: Listener) => {
      listeners.set(event, cb);
      return Promise.resolve({ remove: () => {} });
    }),
    setQueue: vi.fn().mockResolvedValue(undefined),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    seek: vi.fn().mockResolvedValue(undefined),
    next: vi.fn().mockResolvedValue(undefined),
    prev: vi.fn().mockResolvedValue(undefined),
    setVolume: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn(() => new Promise(() => {})),
  };
  if (withOverlay) {
    plugin.playOverlay = vi.fn(() => new Promise((r) => (startResolve = r)));
    plugin.stopOverlay = vi.fn().mockResolvedValue(undefined);
  }
  (window as unknown as { Capacitor: unknown }).Capacitor = { Plugins: { EmberPlayer: plugin } };
  return {
    plugin,
    start: (r: { started: boolean; reason?: string }) => startResolve(r),
    emit: (event: string, d: unknown) => listeners.get(event)?.(d),
    hasListener: (event: string) => listeners.has(event),
  };
}

const opts = { volume: 0.5, duckTo: 0.3, maxSec: 30 };

describe('androidBackend: prank overlay', () => {
  beforeEach(() => noise.log.mockReset());
  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    vi.useRealTimers();
  });

  it('an app build without the methods has no overlay at all', () => {
    const n = installPlugin(false);
    const b = createAndroidBackend(makeFakeEvents());
    expect(b.playOverlay).toBeUndefined();
    expect(b.stopOverlay).toBeUndefined();
    expect(n.hasListener('overlay')).toBe(false);
  });

  it('forwards the sound, relative URL and all, with an id per sound', async () => {
    const n = installPlugin(true);
    const b = createAndroidBackend(makeFakeEvents());
    b.playOverlay!('/api/pranks/media/s1', opts);
    b.playOverlay!('/api/pranks/media/s2', opts);
    expect(n.plugin.playOverlay).toHaveBeenNthCalledWith(1, { id: 'o1', url: '/api/pranks/media/s1', ...opts });
    expect(n.plugin.playOverlay).toHaveBeenNthCalledWith(2, { id: 'o2', url: '/api/pranks/media/s2', ...opts });
  });

  it('started once native says it is heard, finished on its ended event', async () => {
    const n = installPlugin(true);
    const b = createAndroidBackend(makeFakeEvents());
    const h = b.playOverlay!('/api/pranks/media/s1', opts);
    n.start({ started: true });
    expect(await h.started).toBe(true);
    // Another sound's end is not this one's.
    n.emit('overlay', { id: 'o9', phase: 'ended', reason: 'ended', playedSec: 1 });
    n.emit('overlay', { id: 'o1', phase: 'ended', reason: 'cap', playedSec: 30 });
    expect(await h.finished).toEqual({ reason: 'cap', playedSec: 30 });
  });

  it('maps an unknown reason to error and a bad length to zero', async () => {
    const n = installPlugin(true);
    const b = createAndroidBackend(makeFakeEvents());
    const h = b.playOverlay!('/x', opts);
    n.start({ started: true });
    await h.started;
    n.emit('overlay', { id: 'o1', phase: 'ended', reason: 'weird', playedSec: 'NaN' });
    expect(await h.finished).toEqual({ reason: 'error', playedSec: 0 });
  });

  it('a sound that never starts finishes as an error', async () => {
    const n = installPlugin(true);
    const b = createAndroidBackend(makeFakeEvents());
    const h = b.playOverlay!('/x', opts);
    n.start({ started: false, reason: 'error:load' });
    expect(await h.started).toBe(false);
    expect(await h.finished).toEqual({ reason: 'error', playedSec: 0 });
  });

  it('a rejected call (a bridge fault) is a sound that never started, silently', async () => {
    const n = installPlugin(true);
    (n.plugin.playOverlay as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('bridge'));
    const b = createAndroidBackend(makeFakeEvents());
    const h = b.playOverlay!('/x', opts);
    expect(await h.started).toBe(false);
    expect(await h.finished).toEqual({ reason: 'error', playedSec: 0 });
    expect(noise.log).not.toHaveBeenCalled();
  });

  it('gives up waiting for the end a little after the cap', async () => {
    vi.useFakeTimers();
    const n = installPlugin(true);
    const b = createAndroidBackend(makeFakeEvents());
    const h = b.playOverlay!('/x', { ...opts, maxSec: 10 });
    n.start({ started: true });
    await h.started;
    let done: unknown = null;
    void h.finished.then((r) => (done = r));
    await vi.advanceTimersByTimeAsync(10_000 + OVERLAY_END_GRACE_MS - 1);
    expect(done).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toEqual({ reason: 'cap', playedSec: 10 });
  });

  it('stopOverlay forwards to the plugin', () => {
    const n = installPlugin(true);
    const b = createAndroidBackend(makeFakeEvents());
    b.stopOverlay!();
    expect(n.plugin.stopOverlay).toHaveBeenCalledTimes(1);
  });
});

// The loop button on a phone. The native player repeats (and stops at the
// end of the queue) by itself, so it must be told the mode; the car and the
// notification have their own Repeat button, whose changes come back here.
describe('androidBackend: loop mode', () => {
  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  });

  const state = (loop: string) => ({ playing: true, position: 0, duration: 0, index: 0, trackId: 'a', loop });

  function setup() {
    const n = installPlugin(false);
    n.plugin.setRepeat = vi.fn().mockResolvedValue(undefined);
    const events = { ...makeFakeEvents(), onLoopMode: vi.fn() };
    const b = createAndroidBackend(events);
    return { n, events, b };
  }

  it('sends the loop mode to the native player', () => {
    const { n, b } = setup();
    b.setLoop!('all');
    b.setLoop!('one');
    expect(n.plugin.setRepeat).toHaveBeenNthCalledWith(1, { mode: 'all' });
    expect(n.plugin.setRepeat).toHaveBeenNthCalledWith(2, { mode: 'one' });
  });

  it('does not resend the mode native already has', () => {
    const { n, b } = setup();
    n.emit('state', state('all'));
    b.setLoop!('all');
    expect(n.plugin.setRepeat).not.toHaveBeenCalled();
  });

  it('mirrors a change made in the car or notification', () => {
    const { n, events } = setup();
    n.emit('state', state('off'));
    n.emit('state', state('all'));
    n.emit('state', state('all'));
    n.emit('state', state('one'));
    expect(events.onLoopMode.mock.calls).toEqual([['all'], ['one']]);
  });

  it('the first report only records what native has (the app decides at startup)', () => {
    const { n, events } = setup();
    n.emit('state', state('one'));
    expect(events.onLoopMode).not.toHaveBeenCalled();
  });

  it('never echoes its own changes back, even several fast taps', () => {
    const { n, b, events } = setup();
    n.emit('state', state('off'));
    b.setLoop!('all');
    b.setLoop!('one');
    b.setLoop!('off');
    n.emit('state', state('all'));
    n.emit('state', state('one'));
    n.emit('state', state('off'));
    expect(events.onLoopMode).not.toHaveBeenCalled();
    // A car tap after that still gets through.
    n.emit('state', state('all'));
    expect(events.onLoopMode).toHaveBeenCalledWith('all');
  });

  it('an app build without the method is left alone', () => {
    const n = installPlugin(false);
    const b = createAndroidBackend(makeFakeEvents());
    expect(() => b.setLoop!('all')).not.toThrow();
    n.emit('state', { playing: true, position: 0, duration: 0, index: 0, trackId: 'a' });
  });
});

describe('androidBackend: a page starting while native already plays', () => {
  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    vi.useRealTimers();
  });

  const t = (id: string) => ({ id, title: id }) as never;
  const flush = () => new Promise((r) => setTimeout(r, 0));

  /** A plugin whose getState/getQueue answer with what native has. */
  function withNative(state: Record<string, unknown>, queue: { tracks: unknown[]; index: number } | null) {
    const n = installPlugin(false);
    n.plugin.getState = vi.fn().mockResolvedValue(state);
    if (queue) n.plugin.getQueue = vi.fn().mockResolvedValue(queue);
    const events = { ...makeFakeEvents(), onQueueReplaced: vi.fn(), onQueueIndex: vi.fn() };
    const b = createAndroidBackend(events);
    return { n, b, events };
  }

  it('takes native\'s queue instead of pushing the saved one over it (the music no longer jumps back)', async () => {
    const { n, b, events } = withNative(
      { playing: true, position: 40, duration: 200, index: 1, trackId: 'y' },
      { tracks: [t('x'), t('y'), t('z')], index: 1 },
    );
    // The provider restores the saved queue, paused, before native answers.
    b.setQueue!([t('a'), t('b')], 1, false);
    await flush();
    expect(n.plugin.setQueue).not.toHaveBeenCalled();
    expect(events.onQueueReplaced).toHaveBeenCalledWith([t('x'), t('y'), t('z')], 1);
    // Already at native's index: no second move on top.
    expect(events.onQueueIndex).not.toHaveBeenCalled();
  });

  it('same queue, native moved on: nothing is sent, the page follows native\'s index', async () => {
    const { n, b, events } = withNative(
      { playing: true, position: 5, duration: 200, index: 2, trackId: 'c' },
      { tracks: [t('a'), t('b'), t('c')], index: 2 },
    );
    b.setQueue!([t('a'), t('b'), t('c')], 0, false);
    await flush();
    expect(n.plugin.setQueue).not.toHaveBeenCalled();
    expect(events.onQueueReplaced).not.toHaveBeenCalled();
    expect(events.onQueueIndex).toHaveBeenCalledWith(2);
  });

  it('native empty (a fresh start): the saved queue goes over, paused, as before', async () => {
    const { n, b } = withNative({ playing: false, position: 0, duration: 0, index: -1, trackId: null }, { tracks: [], index: -1 });
    b.setQueue!([t('a'), t('b')], 1, false);
    await flush();
    expect(n.plugin.setQueue).toHaveBeenCalledTimes(1);
    expect(n.plugin.setQueue).toHaveBeenCalledWith(expect.objectContaining({ tracks: [t('a'), t('b')], index: 1, play: false }));
  });

  it('a tap never waits, and drops the saved queue still waiting', async () => {
    const { n, b } = withNative(
      { playing: true, position: 5, duration: 200, index: 0, trackId: 'x' },
      { tracks: [t('x')], index: 0 },
    );
    b.setQueue!([t('a')], 0, false);
    b.setQueue!([t('c'), t('d')], 1, true);
    expect(n.plugin.setQueue).toHaveBeenCalledTimes(1);
    expect(n.plugin.setQueue).toHaveBeenCalledWith(expect.objectContaining({ tracks: [t('c'), t('d')], index: 1, play: true }));
    await flush();
    expect(n.plugin.setQueue).toHaveBeenCalledTimes(1);
  });

  it('an app build without getQueue keeps the saved queue when it is what native plays', async () => {
    const { n, b } = withNative({ playing: true, position: 5, duration: 200, index: 1, trackId: 'b' }, null);
    b.setQueue!([t('a'), t('b')], 0, false);
    await flush();
    expect(n.plugin.setQueue).not.toHaveBeenCalled();
  });

  it('an app build without getQueue, playing something else: the saved queue goes over as before', async () => {
    const { n, b } = withNative({ playing: true, position: 5, duration: 200, index: 0, trackId: 'q' }, null);
    b.setQueue!([t('a'), t('b')], 0, false);
    await flush();
    expect(n.plugin.setQueue).toHaveBeenCalledTimes(1);
  });

  it('a slow answer is waited for, however slow: native playing is never guessed empty', async () => {
    vi.useFakeTimers();
    const n = installPlugin(false);
    let answer: (s: unknown) => void = () => {};
    n.plugin.getState = vi.fn(() => new Promise((r) => (answer = r)));
    n.plugin.getQueue = vi.fn().mockResolvedValue({ tracks: [t('x')], index: 0 });
    const events = { ...makeFakeEvents(), onQueueReplaced: vi.fn() };
    const b = createAndroidBackend(events);
    b.setQueue!([t('a')], 0, false);
    vi.advanceTimersByTime(30_000);
    expect(n.plugin.setQueue).not.toHaveBeenCalled();
    answer({ playing: true, position: 3, duration: 100, index: 0, trackId: 'x' });
    await vi.runAllTimersAsync();
    expect(n.plugin.setQueue).not.toHaveBeenCalled();
    expect(events.onQueueReplaced).toHaveBeenCalledWith([t('x')], 0);
    // The late answer still reaches the page as native's state.
    expect(events.onTime).toHaveBeenCalledWith(3);
  });

  it('a bridge that fails to answer sends the saved queue', async () => {
    const n = installPlugin(false);
    n.plugin.getState = vi.fn().mockRejectedValue(new Error('bridge'));
    const b = createAndroidBackend(makeFakeEvents());
    b.setQueue!([t('a')], 0, false);
    await flush();
    expect(n.plugin.setQueue).toHaveBeenCalledTimes(1);
  });
});

describe('androidBackend: start position', () => {
  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  });

  it('passes a start position with a queue, and none for 0', async () => {
    const n = installPlugin(false);
    n.plugin.getState = vi.fn().mockResolvedValue({ playing: false, position: 0, duration: 0, index: -1, trackId: null });
    const b = createAndroidBackend(makeFakeEvents());
    b.setQueue!([{ id: 'a' } as never], 0, false, undefined, 95);
    await new Promise((r) => setTimeout(r, 0));
    expect(n.plugin.setQueue).toHaveBeenLastCalledWith(expect.objectContaining({ play: false, startSec: 95 }));
    b.setQueue!([{ id: 'b' } as never], 0, true, undefined, 0);
    expect((n.plugin.setQueue as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).not.toHaveProperty('startSec');
  });
});
