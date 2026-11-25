import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAndroidBackend } from './androidBackend';
import { makeTrack } from '@/test-utils/fakeBackend';
import type { Track } from '@/types/track';

// Bug report 2026-11-17: "desynced song player and what song is actually
// playing when opening app after a while". Native kept playing for hours
// while the page was away; back on screen the bar showed the song the page
// last knew (Demetori, entry 2 of the page's 15) while native played another
// (ICDD), and play/pause drove native's song. Coming back, the page asked
// native for its state only, never for its queue, and laid native's bare
// index over its own list: whatever native had moved on to that the page
// never heard about (a queue event lost while away) stayed wrong for good.

vi.mock('@/lib/logger/client', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), breadcrumb: vi.fn() } }));

type Listener = (d: unknown) => void;
type State = { playing: boolean; position: number; duration: number; index: number; trackId: string | null; at?: number };
type Queue = { tracks: Track[]; index: number; shuffle?: boolean };

const t = (id: string) => makeTrack({ id });
const list = (...ids: string[]) => ids.map(t);

/** A plugin answering getState/getQueue with what native has now. */
function installPlugin(native: { state: State; queue: Queue }) {
  const listeners = new Map<string, Listener>();
  const plugin: Record<string, unknown> = {
    addListener: vi.fn((event: string, cb: Listener) => {
      listeners.set(event, cb);
      return Promise.resolve({ remove: () => {} });
    }),
    // Native takes the page's list before it answers anything asked later.
    setQueue: vi.fn((o: { tracks: Track[]; index: number }) => {
      native.queue = { tracks: o.tracks, index: o.index };
      native.state = st(o.index, o.tracks[o.index]?.id ?? '');
      return Promise.resolve();
    }),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    seek: vi.fn().mockResolvedValue(undefined),
    next: vi.fn().mockResolvedValue(undefined),
    prev: vi.fn().mockResolvedValue(undefined),
    setVolume: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn(() => Promise.resolve({ ...native.state })),
    getQueue: vi.fn(() => Promise.resolve({ ...native.queue })),
  };
  (window as unknown as { Capacitor: unknown }).Capacitor = { Plugins: { EmberPlayer: plugin } };
  return { plugin, native, emit: (event: string, d: unknown) => listeners.get(event)?.(d) };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Every event the backend reports, in one ordered log as well as spies. */
function fakeEvents() {
  const log: string[] = [];
  const spy = (name: string) => vi.fn((...a: unknown[]) => { log.push(`${name}:${JSON.stringify(a[0])}`); });
  return {
    log,
    onTime: spy('time'),
    onDuration: vi.fn(),
    onEnded: vi.fn(),
    onPlay: vi.fn(),
    onPause: vi.fn(),
    onError: vi.fn(),
    onQueueIndex: spy('index'),
    onQueueReplaced: vi.fn((tracks: Track[], i: number) => { log.push(`queue:${tracks.map((x) => x.id).join(',')}@${i}`); }),
  };
}

let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
function hide() {
  visibility = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
}
function show() {
  visibility = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
}

const st = (index: number, trackId: string, position = 10, extra: Partial<State> = {}): State => ({
  playing: true, position, duration: 200, index, trackId, ...extra,
});

/** A page that has handed native its queue (a, b, c) and heard it play b. */
async function playing() {
  const n = installPlugin({ state: st(-1, '', 0, { trackId: null, playing: false }), queue: { tracks: [], index: -1 } });
  const events = fakeEvents();
  const b = createAndroidBackend(events);
  await flush();
  b.setQueue!(list('a', 'b', 'c'), 1, true);
  n.native.queue = { tracks: list('a', 'b', 'c'), index: 1 };
  n.native.state = st(1, 'b');
  n.emit('state', st(1, 'b'));
  vi.mocked(n.plugin.getState as () => unknown).mockClear();
  vi.mocked(n.plugin.getQueue as () => unknown).mockClear();
  events.onQueueIndex.mockClear();
  events.onQueueReplaced.mockClear();
  events.onTime.mockClear();
  events.log.length = 0;
  return { n, b, events };
}

describe('androidBackend: the page comes back after a while away', () => {
  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    visibility = 'visible';
  });

  it('asks native for its queue as well as its state, and takes the queue first', async () => {
    const { n, events } = await playing();
    hide();
    // While away native ran out of the page's list and its radio added
    // songs; the queue event that said so never reached the page.
    n.native.queue = { tracks: list('a', 'b', 'c', 'r1', 'r2'), index: 4 };
    n.native.state = st(4, 'r2', 33);
    show();
    await flush();
    expect(n.plugin.getQueue).toHaveBeenCalledTimes(1);
    expect(events.onQueueReplaced).toHaveBeenCalledTimes(1);
    expect(events.onQueueReplaced.mock.calls[0][0].map((x: Track) => x.id)).toEqual(['a', 'b', 'c', 'r1', 'r2']);
    // Native's queue before native's position in it: the bar never shows
    // entry 4 of the page's old three-song list.
    expect(events.log).toEqual(['queue:a,b,c,r1,r2@4', 'time:33']);
    expect(events.onPlay).toHaveBeenCalled();
  });

  it('the same queue as the page has is not handed over again', async () => {
    const { n, events } = await playing();
    hide();
    n.native.state = st(2, 'c', 5);
    n.native.queue = { tracks: list('a', 'b', 'c'), index: 2 };
    show();
    await flush();
    expect(events.onQueueReplaced).not.toHaveBeenCalled();
    expect(events.onQueueIndex).toHaveBeenCalledWith(2, { trackId: 'c' });
    expect(events.onTime).toHaveBeenLastCalledWith(5);
  });

  it('a state whose song is not the page\'s entry at that index fetches native\'s queue instead of moving the bar there', async () => {
    const { n, events } = await playing();
    // Native's list changed under the page (a lost queue event): entry 2 is
    // a song the page does not have there.
    n.native.queue = { tracks: list('x', 'y', 'z'), index: 2 };
    n.native.state = st(2, 'z', 1);
    n.emit('state', st(2, 'z', 1));
    expect(events.onQueueIndex).not.toHaveBeenCalled();
    await flush();
    expect(n.plugin.getQueue).toHaveBeenCalledTimes(1);
    expect(events.log[0]).toBe('queue:x,y,z@2');
    expect(events.onTime).toHaveBeenLastCalledWith(1);
  });

  it('an index past the end of the page\'s list does the same', async () => {
    const { n, events } = await playing();
    n.native.queue = { tracks: list('a', 'b', 'c', 'd', 'e'), index: 4 };
    n.native.state = st(4, 'e');
    n.emit('state', st(4, 'e'));
    await flush();
    expect(events.onQueueReplaced).toHaveBeenCalledTimes(1);
    expect(events.onQueueReplaced.mock.calls[0][1]).toBe(4);
  });

  it('a mismatch native cannot explain asks once, then follows by song id', async () => {
    const { n, events } = await playing();
    // Native says entry 2 is z but its queue answer still lists the page's
    // songs (an item it could not describe): no loop of questions.
    n.native.state = st(2, 'z');
    n.emit('state', st(2, 'z'));
    await flush();
    n.emit('state', st(2, 'z', 11));
    n.emit('state', st(2, 'z', 12));
    await flush();
    expect(n.plugin.getQueue).toHaveBeenCalledTimes(1);
    expect(events.onQueueIndex).toHaveBeenCalledWith(2, { trackId: 'z' });
    expect(events.onTime).toHaveBeenLastCalledWith(12);
  });

  it('the page\'s own new list wins over a queue answer asked for before it', async () => {
    const { n, b, events } = await playing();
    hide();
    n.native.queue = { tracks: list('old1', 'old2'), index: 0 };
    n.native.state = st(0, 'old1');
    show();
    // A tap on a new list before the answer is in.
    b.setQueue!(list('n1', 'n2'), 0, true);
    await flush();
    expect(events.onQueueReplaced).not.toHaveBeenCalled();
  });

  it('a state from just before native took the page\'s own new list does not hand that list back', async () => {
    const { n, b, events } = await playing();
    // The page moved b to the end (a queue sheet edit).
    b.setQueue!(list('a', 'c', 'b'), 2, true);
    n.native.queue = { tracks: list('a', 'c', 'b'), index: 2 };
    n.native.state = st(2, 'b');
    // Native still on its old order for one more tick: b at 1, where the
    // page now has c.
    n.emit('state', st(1, 'b'));
    await flush();
    expect(n.plugin.getQueue).toHaveBeenCalledTimes(1);
    expect(events.onQueueReplaced).not.toHaveBeenCalled();
    expect(events.onQueueIndex).toHaveBeenLastCalledWith(2, { trackId: 'b' });
  });

  it('an app build without getQueue resyncs the state as before', async () => {
    const { n, events } = await playing();
    delete n.plugin.getQueue;
    hide();
    n.native.state = st(2, 'c', 7);
    show();
    await flush();
    expect(events.onQueueReplaced).not.toHaveBeenCalled();
    expect(events.onQueueIndex).toHaveBeenCalledWith(2, { trackId: 'c' });
    expect(events.onTime).toHaveBeenLastCalledWith(7);
  });

  it('an empty native queue does not wipe the page\'s list', async () => {
    const { n, events } = await playing();
    hide();
    n.native.queue = { tracks: [], index: -1 };
    n.native.state = st(-1, '', 0, { trackId: null, playing: false });
    show();
    await flush();
    expect(events.onQueueReplaced).not.toHaveBeenCalled();
  });
});

describe('androidBackend: a page re-created while native plays', () => {
  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  });

  it('native answering before the page restored its queue: the page still takes native\'s queue', async () => {
    const n = installPlugin({ state: st(3, 'icdd', 90), queue: { tracks: list('p', 'q', 'r', 'icdd'), index: 3 } });
    const events = fakeEvents();
    createAndroidBackend(events);
    await flush();
    expect(events.onQueueReplaced).toHaveBeenCalledTimes(1);
    expect(events.log).toEqual(['queue:p,q,r,icdd@3', 'time:90']);
    expect(n.plugin.setQueue).not.toHaveBeenCalled();
  });
});
