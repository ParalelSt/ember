import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAndroidBackend, RESYNC_GIVE_UP_MS, STALE_STATE_MS } from './androidBackend';

// Coming back to the app after the screen was off (bug report 2026-10-09).
// Chromium froze the hidden page and every state event native sent waited in
// line; back on screen the page replayed minutes of them, the bar raced
// through songs long finished and the page was too busy to draw. The page now
// asks native for its state when it comes back and drops the held events.

vi.mock('@/lib/logger/client', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

type Listener = (d: unknown) => void;
type State = { playing: boolean; position: number; duration: number; index: number; trackId: string | null; at?: number };

function installPlugin() {
  const listeners = new Map<string, Listener>();
  const answers: Array<(s: State) => void> = [];
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
    // Every call waits for the test to answer it, in order.
    getState: vi.fn(() => new Promise<State>((r) => answers.push(r))),
  };
  (window as unknown as { Capacitor: unknown }).Capacitor = { Plugins: { EmberPlayer: plugin } };
  return {
    plugin,
    emit: (event: string, d: unknown) => listeners.get(event)?.(d),
    /** Answer the oldest getState call still waiting. */
    answer: async (s: State) => {
      answers.shift()?.(s);
      await flush();
    },
    waiting: () => answers.length,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Every event the backend reports, as spies. */
const fakeEvents = () => ({
  onTime: vi.fn(),
  onDuration: vi.fn(),
  onEnded: vi.fn(),
  onPlay: vi.fn(),
  onPause: vi.fn(),
  onError: vi.fn(),
  onQueueIndex: vi.fn(),
});

let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
function show(event: 'visibilitychange' | 'resume' = 'visibilitychange') {
  visibility = 'visible';
  document.dispatchEvent(new Event(event));
}
function hide() {
  visibility = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
}

const st = (index: number, position: number, extra: Partial<State> = {}): State => ({
  playing: true,
  position,
  duration: 200,
  index,
  trackId: `t${index}`,
  ...extra,
});

/** A backend that has settled on native's opening state (index 0, 10 s). */
async function started() {
  const n = installPlugin();
  const events = fakeEvents();
  const b = createAndroidBackend(events);
  await n.answer(st(0, 10));
  events.onTime.mockClear();
  events.onQueueIndex.mockClear();
  return { n, b, events };
}

describe('androidBackend: back on screen after the page was frozen', () => {
  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    visibility = 'visible';
    vi.useRealTimers();
  });

  it('drops the held events and shows what native plays now', async () => {
    const { n, events } = await started();
    hide();
    show();
    expect(n.plugin.getState).toHaveBeenCalledTimes(2);
    // The line of events held while frozen: three songs' worth, 4 a second.
    for (let i = 0; i < 3; i++) for (let sec = 0; sec < 200; sec += 0.25) n.emit('state', st(i, sec));
    expect(events.onTime).not.toHaveBeenCalled();
    expect(events.onQueueIndex).not.toHaveBeenCalled();
    // The answer comes down the same line, after all of them.
    await n.answer(st(3, 42));
    expect(events.onQueueIndex).toHaveBeenCalledTimes(1);
    expect(events.onQueueIndex).toHaveBeenCalledWith(3);
    expect(events.onTime).toHaveBeenCalledTimes(1);
    expect(events.onTime).toHaveBeenCalledWith(42);
    // Then the page follows native live again.
    n.emit('state', st(3, 42.25));
    expect(events.onTime).toHaveBeenLastCalledWith(42.25);
  });

  it('the page coming out of a freeze (resume) resyncs too', async () => {
    const { n, events } = await started();
    show('resume');
    n.emit('state', st(1, 5));
    expect(events.onTime).not.toHaveBeenCalled();
    await n.answer(st(2, 7));
    expect(events.onQueueIndex).toHaveBeenCalledWith(2);
    expect(events.onTime).toHaveBeenCalledWith(7);
  });

  it('a pause made while away is what the page shows, not the old playing', async () => {
    const { n, events } = await started();
    events.onPlay.mockClear();
    events.onPause.mockClear();
    show();
    n.emit('state', st(0, 11));
    await n.answer(st(0, 30, { playing: false }));
    expect(events.onPlay).not.toHaveBeenCalled();
    expect(events.onPause).toHaveBeenCalledTimes(1);
  });

  it('going hidden asks nothing; one resync at a time however often it is shown', async () => {
    const { n } = await started();
    hide();
    expect(n.plugin.getState).toHaveBeenCalledTimes(1);
    show();
    show('resume');
    show();
    expect(n.plugin.getState).toHaveBeenCalledTimes(2);
    await n.answer(st(0, 12));
    show();
    expect(n.plugin.getState).toHaveBeenCalledTimes(3);
  });

  it('a state native dated long ago starts a resync on its own', async () => {
    const { n, events } = await started();
    const now = Date.now();
    n.emit('state', st(0, 11, { at: now - 200 }));
    expect(events.onTime).toHaveBeenLastCalledWith(11);
    n.emit('state', st(1, 3, { at: now - STALE_STATE_MS - 60_000 }));
    expect(n.plugin.getState).toHaveBeenCalledTimes(2);
    expect(events.onQueueIndex).not.toHaveBeenCalled();
    n.emit('state', st(2, 3, { at: now - STALE_STATE_MS - 30_000 }));
    expect(n.plugin.getState).toHaveBeenCalledTimes(2);
    await n.answer(st(4, 9, { at: Date.now() }));
    expect(events.onQueueIndex).toHaveBeenCalledTimes(1);
    expect(events.onQueueIndex).toHaveBeenCalledWith(4);
  });

  it('an app build that does not date its states is followed as before', async () => {
    const { n, events } = await started();
    n.emit('state', st(1, 3));
    n.emit('state', st(1, 3.25));
    expect(n.plugin.getState).toHaveBeenCalledTimes(1);
    expect(events.onQueueIndex).toHaveBeenCalledWith(1);
    expect(events.onTime).toHaveBeenLastCalledWith(3.25);
  });

  it('an answer that never comes stops holding events back', async () => {
    vi.useFakeTimers();
    const n = installPlugin();
    const events = fakeEvents();
    createAndroidBackend(events);
    show();
    n.emit('state', st(1, 3));
    expect(events.onTime).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RESYNC_GIVE_UP_MS);
    n.emit('state', st(1, 4));
    expect(events.onTime).toHaveBeenCalledWith(4);
  });

  it('a failed answer stops holding events back', async () => {
    const n = installPlugin();
    const events = fakeEvents();
    createAndroidBackend(events);
    n.plugin.getState = vi.fn().mockRejectedValue(new Error('bridge'));
    show();
    await flush();
    n.emit('state', st(1, 4));
    expect(events.onTime).toHaveBeenCalledWith(4);
  });

  it('destroy stops listening for the page coming back', async () => {
    const { n, b } = await started();
    b.destroy();
    show();
    expect(n.plugin.getState).toHaveBeenCalledTimes(1);
  });
});
