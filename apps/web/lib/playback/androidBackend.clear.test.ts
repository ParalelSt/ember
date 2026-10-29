import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAndroidBackend } from './androidBackend';
import { makeFakeEvents, makeTrack } from '@/test-utils/fakeBackend';

// Signing out (or another account signing in) empties the web queue, and the
// player hands native an empty queue so the old account's songs stop and go.
// A paused hand-over is held until native has said what it plays, and when
// it plays something the page takes native's queue instead: an empty one held
// that way brought the old account's queue straight back.

vi.mock('@/lib/logger/client', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

function installPlugin() {
  let answerState: (s: unknown) => void = () => {};
  const plugin: Record<string, unknown> = {
    addListener: vi.fn(() => Promise.resolve({ remove: () => {} })),
    setQueue: vi.fn().mockResolvedValue(undefined),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn(() => new Promise((r) => (answerState = r))),
    getQueue: vi.fn().mockResolvedValue({ tracks: [makeTrack({ id: 'youtube:old' })], index: 0 }),
    drainUnplayable: vi.fn().mockResolvedValue({ notices: [] }),
  };
  (window as unknown as { Capacitor: unknown }).Capacitor = { Plugins: { EmberPlayer: plugin } };
  return { plugin, answerState: (s: unknown) => answerState(s) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('androidBackend: an empty queue clears native', () => {
  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  });

  it('goes to native at once, even before native has answered, and native\'s old queue is not taken back', async () => {
    const n = installPlugin();
    const events = { ...makeFakeEvents(), onQueueReplaced: vi.fn() };
    const b = createAndroidBackend(events);
    b.setQueue!([], 0, false);
    expect(n.plugin.setQueue).toHaveBeenCalledWith(expect.objectContaining({ tracks: [], index: 0, play: false }));
    n.answerState({ playing: true, index: 0, trackId: 'youtube:old', position: 10, duration: 200, loop: 'off', shuffle: false });
    await flush();
    await flush();
    expect(events.onQueueReplaced).not.toHaveBeenCalled();
  });
});
