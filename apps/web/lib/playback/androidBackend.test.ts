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
