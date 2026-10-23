import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAndroidBackend } from './androidBackend';
import { makeFakeEvents, makeTrack } from '@/test-utils/fakeBackend';

// A destroyed backend (the provider unmounting, or React's dev double mount,
// which builds a second one right after) used to leave its native listeners
// on: both backends answered every native event, so one `ended` or `error`
// reached the player twice, and a startup answer that landed after the
// destroy still pushed the saved queue to native.

vi.mock('@/lib/logger/client', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

type Listener = (d: unknown) => void;

function installPlugin() {
  const listeners = new Map<string, Listener[]>();
  const removed: string[] = [];
  let answerState: (s: unknown) => void = () => {};
  const plugin: Record<string, unknown> = {
    addListener: vi.fn((event: string, cb: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), cb]);
      return Promise.resolve({
        remove: () => {
          removed.push(event);
          listeners.set(event, (listeners.get(event) ?? []).filter((l) => l !== cb));
        },
      });
    }),
    setQueue: vi.fn().mockResolvedValue(undefined),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn(() => new Promise((r) => (answerState = r))),
    drainUnplayable: vi.fn().mockResolvedValue({ notices: [] }),
  };
  (window as unknown as { Capacitor: unknown }).Capacitor = { Plugins: { EmberPlayer: plugin } };
  return {
    plugin,
    removed,
    emit: (event: string, d: unknown) => (listeners.get(event) ?? []).forEach((l) => l(d)),
    answerState: (s: unknown) => answerState(s),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('androidBackend: destroy', () => {
  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  });

  it('takes its native listeners with it', async () => {
    const n = installPlugin();
    const events = makeFakeEvents();
    const b = createAndroidBackend(events);
    b.destroy();
    await flush();
    expect(n.removed).toEqual(expect.arrayContaining(['state', 'queue', 'ended', 'error', 'unplayable']));
    n.emit('ended', {});
    n.emit('error', { message: 'boom' });
    expect(events.onEnded).not.toHaveBeenCalled();
    expect(events.onError).not.toHaveBeenCalled();
  });

  it('one native end reaches the player once when a second backend replaced the first', async () => {
    const n = installPlugin();
    const first = makeFakeEvents();
    createAndroidBackend(first).destroy();
    const second = makeFakeEvents();
    createAndroidBackend(second);
    n.emit('ended', {});
    expect(first.onEnded).not.toHaveBeenCalled();
    expect(second.onEnded).toHaveBeenCalledTimes(1);
  });

  it('a startup answer that lands after the destroy pushes nothing to native', async () => {
    const n = installPlugin();
    const events = makeFakeEvents();
    const b = createAndroidBackend(events);
    // The page restoring its saved queue: held until native has answered.
    b.setQueue!([makeTrack({ id: 'youtube:a' }), makeTrack({ id: 'youtube:b' })], 0, false);
    b.destroy();
    n.answerState({ playing: false, position: 0, duration: 0, index: -1, trackId: null });
    await flush();
    expect(n.plugin.setQueue).not.toHaveBeenCalled();
    expect(events.onTime).not.toHaveBeenCalled();
  });
});
