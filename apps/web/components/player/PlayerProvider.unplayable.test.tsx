/** A song that cannot be played, on the web and desktop engines and the
 *  Android player: the listener is told which song and why, the song stays in
 *  the queue greyed with its reason, and a queue where nothing plays stops
 *  with a message instead of spinning.
 *
 *  The report behind this (2026-09-30): radio queued songs YouTube had taken
 *  down; the Android app skipped them with no word, and at the end of the
 *  queue it just stopped. The real probe (useAvailabilityProbe) and the real
 *  radio (useRadioExtend) run here; only the server's answers are faked.
 *
 *  Said in the player bar itself (stores/useUnplayableStore), never as a
 *  toast: `messages()` is every sentence the bar's message has carried. */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { PlayerProvider, usePlayer } from './PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { resetUnplayableStore, useUnplayableStore } from '@/stores/useUnplayableStore';
import { barLines } from '@/lib/playback/unplayableBar';
import { makeFakeBackend, makeTrack } from '@/test-utils/fakeBackend';
import type { AudioBackendEvents } from '@/lib/playback/types';
import type { Track } from '@/types/track';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const api = vi.hoisted(() => ({
  getTrackAvailability: vi.fn(),
  getRecommended: vi.fn(),
  getTrackGain: vi.fn(async () => ({ gainDb: null })),
}));
vi.mock('@/lib/api', () => ({ api, apiUrl: (u: string) => u }));
vi.mock('@/lib/logger/client', () => ({
  logger: { boot: vi.fn(), setContext: vi.fn(), breadcrumb: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));

const shell = vi.hoisted(() => ({ kind: 'web' as 'web' | 'capacitor' }));
vi.mock('@/lib/playback/detectShell', () => ({ detectShell: () => shell.kind }));

const engine = makeFakeBackend();
let events: AudioBackendEvents | null = null;
vi.mock('@/lib/playback/webBackend', () => ({
  createWebBackend: (e: AudioBackendEvents) => { events = e; return engine; },
}));
const native = vi.hoisted(() => ({ setQueue: vi.fn(), setLoop: vi.fn(), next: vi.fn(), prev: vi.fn() }));
vi.mock('@/lib/playback/androidBackend', () => ({
  androidPluginPresent: () => true,
  createAndroidBackend: (e: AudioBackendEvents) => { events = e; return Object.assign(engine, native); },
}));

const autoCache = vi.hoisted(() => ({ onGone: null as ((id: string) => void) | null }));
vi.mock('@/hooks/player/useAutoCache', () => ({
  useAutoCache: (o: { onGone?: (id: string) => void }) => { autoCache.onGone = o.onGone ?? null; },
}));

vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/hooks/useLibrary', () => ({
  QK: { likes: ['likes'], history: ['history'] },
  useQueryHistory: () => ({ data: [] }),
  useQueryLikes: () => ({ data: [] }),
  useExecuteRecordPlay: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/hooks/useLyrics', () => ({ useQueryLyrics: () => ({ data: undefined }) }));
vi.mock('@/hooks/player/useDiscordPresence', () => ({ useDiscordPresence: vi.fn() }));
vi.mock('@/hooks/player/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: vi.fn() }));
vi.mock('@/hooks/player/useRemoteCommands', () => ({ useRemoteCommands: vi.fn() }));
// Signed in (the probe only asks the host for a member), which would start
// the prank inbox: not what is under test.
vi.mock('./PrankReceiver', () => ({ PrankReceiver: () => null }));

const song = (id: string, title: string) => makeTrack({ id: `youtube:${id}`, sourceId: id, title, streamUrl: `/s/${id}`, durationSec: 200 });
const KLINCEK = song('5tStuPCa52c', 'Klinček stoji pod oblokom');
const GONE = song('0LYiIUMeO1o', 'Radio Song One');
const NEXT = song('okvideo0001', 'Plays Fine');

/** The host's verdict per song (the availability route). */
let verdict: Record<string, { unavailable: boolean; reason: string | null }> = {};

function setQueue(queue: Track[], index: number) {
  usePlayerStore.setState({
    queue, index, position: 0, duration: 200, isPlaying: true,
    loopMode: 'off', context: { type: 'single' }, baseCount: 1, shuffle: false, orderBackup: null,
  });
}
const loadedUrls = () => engine.load.mock.calls.map((c) => c[0]);
const current = () => { const s = usePlayerStore.getState(); return s.queue[s.index]; };
/** Every sentence the bar's message carried (a burst grows one message). */
const said: string[] = [];
let unsubscribe = () => {};
const messages = () => [...said];
/** What the bar shows now, or null for the song. */
const bar = () => { const m = useUnplayableStore.getState().message; return m ? barLines(m) : null; };
const noToasts = () => {
  expect(toast).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.clearAllMocks();
  events = null;
  shell.kind = 'web';
  verdict = {};
  api.getTrackAvailability.mockImplementation(async (id: string) => verdict[id] ?? { unavailable: false, reason: null });
  // Radio has nothing new unless a test says so.
  api.getRecommended.mockResolvedValue({ tracks: [] });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  said.length = 0;
  resetUnplayableStore();
  unsubscribe = useUnplayableStore.subscribe((st, prev) => {
    if (st.message && st.message !== prev.message) said.push(barLines(st.message).announcement);
  });
});
afterEach(() => {
  unsubscribe();
  resetUnplayableStore();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

describe('web and desktop: the song playing turns out to be gone', () => {
  it('says which song and why, greys it in the queue, and plays the next one', async () => {
    setQueue([KLINCEK, GONE, NEXT], 1);
    verdict[GONE.id] = { unavailable: true, reason: 'unavailable' };
    render(<PlayerProvider>{null}</PlayerProvider>);
    act(() => events!.onError());

    await waitFor(() => expect(current().id).toBe(NEXT.id));
    expect(messages()).toContain('Couldn\'t play "Radio Song One": not available on YouTube. Skipped to the next song.');
    expect(bar()).toMatchObject({ top: 'Skipped: Radio Song One', bottom: 'Not available on YouTube', sticky: false });
    noToasts();
    // The queue sheet lists it under "Couldn't play".
    expect(useUnplayableStore.getState().couldntPlay.map((n) => n.trackId)).toEqual([GONE.id]);
    const flagged = usePlayerStore.getState().queue[1];
    expect(flagged.id).toBe(GONE.id);
    expect(flagged.unavailableAt).toBeTruthy();
    expect(flagged.unavailableReason).toBe('unavailable');
    expect(loadedUrls()).toContain('/s/okvideo0001');
  });

  it('the reason shows in the words: removed, private, geo, members', async () => {
    setQueue([GONE, NEXT], 0);
    verdict[GONE.id] = { unavailable: true, reason: 'geo' };
    render(<PlayerProvider>{null}</PlayerProvider>);
    act(() => events!.onError());
    await waitFor(() => expect(messages()).toContain('Couldn\'t play "Radio Song One": not available on YouTube in this country. Skipped to the next song.'));
  });

  it('a song that would not load right now: stays on it, says so, is not greyed', async () => {
    setQueue([KLINCEK, NEXT], 0);
    render(<PlayerProvider>{null}</PlayerProvider>);
    act(() => events!.onError());
    await waitFor(() => expect(messages()).toContain('Couldn\'t load "Klinček stoji pod oblokom" right now. Press play to try again.'));
    expect(bar()).toMatchObject({ top: "Couldn't load Klinček stoji pod oblokom right now", bottom: 'Tap to retry', sticky: true, retry: true });
    noToasts();
    expect(current().id).toBe(KLINCEK.id);
    expect(current().unavailableAt).toBeUndefined();
  });

  it('the bar\'s retry loads the song again and the message gives way', async () => {
    setQueue([KLINCEK, NEXT], 0);
    let retry: () => void = () => {};
    function Grab() { retry = usePlayer().retry; return null; }
    render(<PlayerProvider><Grab /></PlayerProvider>);
    act(() => events!.onError());
    await waitFor(() => expect(bar()?.retry).toBe(true));
    const loads = engine.load.mock.calls.length;
    act(() => retry());
    expect(bar()).toBeNull();
    expect(engine.load.mock.calls.length).toBe(loads + 1);
    expect(engine.load.mock.calls.at(-1)![0]).toBe(KLINCEK.streamUrl);
  });

  it('the retry asks the host for a real attempt, past the failure it remembers (normal loads do not)', async () => {
    const real = makeTrack({ id: 'youtube:glitchy0001', sourceId: 'glitchy0001', title: 'Glitchy', streamUrl: '/api/youtube/stream/glitchy0001', durationSec: 200 });
    setQueue([real, NEXT], 0);
    let retry: () => void = () => {};
    function Grab() { retry = usePlayer().retry; return null; }
    render(<PlayerProvider><Grab /></PlayerProvider>);
    expect(loadedUrls().every((u) => !String(u).includes('retry='))).toBe(true);
    act(() => events!.onError());
    await waitFor(() => expect(bar()?.retry).toBe(true));
    act(() => retry());
    expect(engine.load.mock.calls.at(-1)![0]).toBe('/api/youtube/stream/glitchy0001?retry=1');
  });

  it('five dead songs in a row: stops with a message instead of racing through the queue', async () => {
    const dead = Array.from({ length: 7 }, (_, i) => song(`dead${String(i).padStart(7, '0')}`, `Dead ${i}`));
    for (const t of dead) verdict[t.id] = { unavailable: true, reason: 'removed' };
    setQueue(dead, 0);
    render(<PlayerProvider>{null}</PlayerProvider>);
    for (let i = 0; i < 5; i++) {
      const before = current().id;
      act(() => events!.onError());
      if (i < 4) await waitFor(() => expect(current().id).not.toBe(before));
    }
    await waitFor(() => expect(bar()?.top).toBe('Playback stopped'));
    expect(bar()).toMatchObject({ bottom: "5 songs in a row couldn't play", sticky: true });
    // The four skips and the stop were one burst: one message, one sentence.
    expect(messages().at(-1)).toMatch(/^Couldn't play 5 songs \("Dead 0", "Dead 1" and 3 more\).*Playback stopped\.$/);
    noToasts();
    expect(current().id).toBe(dead[4].id);
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });

  it('"Playback stopped" stays until the listener acts: play clears it', async () => {
    const dead = Array.from({ length: 6 }, (_, i) => song(`dead${String(i).padStart(7, '0')}`, `Dead ${i}`));
    for (const t of dead) verdict[t.id] = { unavailable: true, reason: 'removed' };
    setQueue(dead, 0);
    let toggle: () => void = () => {};
    function Grab() { toggle = usePlayer().toggle; return null; }
    render(<PlayerProvider><Grab /></PlayerProvider>);
    for (let i = 0; i < 5; i++) {
      const before = current().id;
      act(() => events!.onError());
      if (i < 4) await waitFor(() => expect(current().id).not.toBe(before));
    }
    await waitFor(() => expect(bar()?.top).toBe('Playback stopped'));
    await new Promise((r) => setTimeout(r, 50));
    expect(bar()?.top).toBe('Playback stopped');
    act(() => toggle());
    expect(bar()).toBeNull();
  });

  it('web audio says "play" for every load: that alone does not reset the count', async () => {
    const dead = Array.from({ length: 7 }, (_, i) => song(`dead${String(i).padStart(7, '0')}`, `Dead ${i}`));
    for (const t of dead) verdict[t.id] = { unavailable: true, reason: 'removed' };
    setQueue(dead, 0);
    render(<PlayerProvider>{null}</PlayerProvider>);
    for (let i = 0; i < 5; i++) {
      const before = current().id;
      act(() => { events!.onPlay(); events!.onTime(0); });
      act(() => events!.onError());
      if (i < 4) await waitFor(() => expect(current().id).not.toBe(before));
    }
    await waitFor(() => expect(bar()?.top).toBe('Playback stopped'));
    expect(current().id).toBe(dead[4].id);
  });

  it('a song that plays in between resets the count', async () => {
    const dead = Array.from({ length: 6 }, (_, i) => song(`dead${String(i).padStart(7, '0')}`, `Dead ${i}`));
    for (const t of dead) verdict[t.id] = { unavailable: true, reason: 'removed' };
    setQueue(dead, 0);
    render(<PlayerProvider>{null}</PlayerProvider>);
    for (let i = 0; i < 5; i++) {
      const before = current().id;
      if (i === 3) act(() => events!.onTime(5));
      act(() => events!.onError());
      await waitFor(() => expect(current().id).not.toBe(before));
    }
    expect(messages().some((m) => /playback stopped/.test(m))).toBe(false);
    expect(bar()?.top).not.toBe('Playback stopped');
  });
});

describe('the last song is gone: radio finds the next one', () => {
  it('waits for radio, then says why and plays what radio found', async () => {
    setQueue([KLINCEK, GONE], 1);
    verdict[GONE.id] = { unavailable: true, reason: 'unavailable' };
    let answer: (v: { tracks: Track[] }) => void = () => {};
    api.getRecommended.mockImplementation(() => new Promise((r) => { answer = r; }));
    render(<PlayerProvider>{null}</PlayerProvider>);
    act(() => events!.onError());
    await waitFor(() => expect(current().unavailableAt).toBeTruthy());
    // Radio was already asked when the song became the last one; nothing is
    // said until it answers.
    expect(api.getRecommended).toHaveBeenCalled();
    expect(messages()).toEqual([]);

    await act(async () => answer({ tracks: [GONE, NEXT] }));
    await waitFor(() => expect(current().id).toBe(NEXT.id));
    expect(messages()).toContain('Couldn\'t play "Radio Song One": not available on YouTube. Skipped to the next song.');
    // The dead one was not queued again.
    expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual([KLINCEK.id, GONE.id, NEXT.id]);
  });

  it('radio finds nothing: says so and stops there', async () => {
    setQueue([KLINCEK, GONE], 1);
    verdict[GONE.id] = { unavailable: true, reason: 'removed' };
    render(<PlayerProvider>{null}</PlayerProvider>);
    act(() => events!.onError());
    await waitFor(() => expect(messages()).toContain('Couldn\'t play "Radio Song One": removed from YouTube. Nothing left to play.'));
    expect(bar()).toMatchObject({ top: "Couldn't play: Radio Song One", bottom: 'Removed from YouTube · Nothing left to play', sticky: true });
    noToasts();
    expect(current().id).toBe(GONE.id);
  });
});

describe('found out ahead of time (a prefetch the host answered 410)', () => {
  it('greys the song in the queue with its reason, silently', async () => {
    setQueue([KLINCEK, GONE, NEXT], 0);
    verdict[GONE.id] = { unavailable: true, reason: 'private' };
    render(<PlayerProvider>{null}</PlayerProvider>);
    act(() => autoCache.onGone!(GONE.id));
    await waitFor(() => expect(usePlayerStore.getState().queue[1].unavailableReason).toBe('private'));
    expect(messages()).toEqual([]);
  });

  it('Next then walks past it and says why', async () => {
    const flagged = { ...GONE, unavailableAt: '2026-09-30T10:00:00Z', unavailableReason: 'private' };
    setQueue([KLINCEK, flagged, NEXT], 0);
    let next: () => void = () => {};
    function Grab() { next = usePlayer().next; return null; }
    render(<PlayerProvider><Grab /></PlayerProvider>);
    act(() => next());
    expect(current().id).toBe(NEXT.id);
    expect(messages()).toContain('Couldn\'t play "Radio Song One": made private on YouTube. Skipped to the next song.');
  });
});

describe('android: the native player reports what it could not play', () => {
  beforeEach(() => { shell.kind = 'capacitor'; });

  it('greys the song and says why, with no question to the host', async () => {
    setQueue([KLINCEK, GONE, NEXT], 2);
    render(<PlayerProvider>{null}</PlayerProvider>);
    act(() => events!.onUnplayable!([
      { trackId: GONE.id, title: GONE.title, kind: 'unavailable', reason: 'unavailable', outcome: 'skipped' },
    ]));
    expect(usePlayerStore.getState().queue[1].unavailableAt).toBeTruthy();
    expect(messages()).toEqual(['Couldn\'t play "Radio Song One": not available on YouTube. Skipped to the next song.']);
    expect(bar()).toMatchObject({ top: 'Skipped: Radio Song One', bottom: 'Not available on YouTube' });
    noToasts();
    expect(api.getTrackAvailability).not.toHaveBeenCalled();
  });

  it('several held while the app was away: one summary, "while you were away"', () => {
    setQueue([KLINCEK, GONE, NEXT], 0);
    render(<PlayerProvider>{null}</PlayerProvider>);
    act(() => events!.onUnplayable!([
      { trackId: GONE.id, title: GONE.title, kind: 'unavailable', reason: 'removed', outcome: 'skipped' },
      { trackId: KLINCEK.id, title: KLINCEK.title, kind: 'unavailable', reason: 'removed', outcome: 'skipped' },
    ], { away: true }));
    expect(messages()).toEqual(['While you were away: Couldn\'t play 2 songs ("Radio Song One" and "Klinček stoji pod oblokom"): they\'re not available on YouTube. They were skipped.']);
    expect(bar()).toMatchObject({ top: 'Skipped 2 songs', bottom: 'While you were away · Removed from YouTube', sticky: false });
    noToasts();
  });

  it('several at once that stopped native: one message, kept until acted on', () => {
    setQueue([KLINCEK, GONE, NEXT], 0);
    render(<PlayerProvider>{null}</PlayerProvider>);
    act(() => events!.onUnplayable!([
      { trackId: GONE.id, title: GONE.title, kind: 'unavailable', reason: 'removed', outcome: 'skipped' },
      { trackId: NEXT.id, title: NEXT.title, kind: 'unavailable', reason: 'removed', outcome: 'stopped' },
    ]));
    expect(messages()).toEqual(['Couldn\'t play 2 songs ("Radio Song One" and "Plays Fine"): they\'re not available on YouTube. Playback stopped.']);
    expect(bar()).toMatchObject({ top: "Couldn't play: Plays Fine", sticky: true });
    noToasts();
  });

  it('while the page is hidden nothing shows; coming back shows it once', () => {
    setQueue([KLINCEK, GONE, NEXT], 0);
    render(<PlayerProvider>{null}</PlayerProvider>);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    act(() => events!.onUnplayable!([{ trackId: GONE.id, title: GONE.title, kind: 'unavailable', reason: 'removed', outcome: 'skipped' }]));
    act(() => events!.onUnplayable!([{ trackId: NEXT.id, title: NEXT.title, kind: 'transient', reason: null, outcome: 'skipped' }]));
    expect(messages()).toEqual([]);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(messages()).toEqual(['While you were away: Couldn\'t play 2 songs ("Radio Song One" and "Plays Fine"): they wouldn\'t load. They were skipped.']);
    expect(bar()).toMatchObject({ top: 'Skipped 2 songs', bottom: "While you were away · They wouldn't play" });
  });

  it('the queue\'s "Couldn\'t play" list fills even while the page is hidden', () => {
    setQueue([KLINCEK, GONE, NEXT], 0);
    render(<PlayerProvider>{null}</PlayerProvider>);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    act(() => events!.onUnplayable!([{ trackId: GONE.id, title: GONE.title, kind: 'unavailable', reason: 'removed', outcome: 'skipped' }]));
    expect(bar()).toBeNull();
    expect(useUnplayableStore.getState().couldntPlay.map((n) => n.trackId)).toEqual([GONE.id]);
  });

  it('an older app build (a bare "error"): the page asks the host about the song native was on', async () => {
    setQueue([KLINCEK, GONE, NEXT], 1);
    verdict[GONE.id] = { unavailable: true, reason: 'unavailable' };
    render(<PlayerProvider>{null}</PlayerProvider>);
    // Native has already moved on by itself.
    act(() => { usePlayerStore.setState({ index: 2 }); });
    act(() => events!.onError({ trackId: GONE.id, nativeExplains: false }));
    await waitFor(() => expect(messages()).toContain('Couldn\'t play "Radio Song One": not available on YouTube. Skipped to the next song.'));
    expect(usePlayerStore.getState().queue[1].unavailableAt).toBeTruthy();
  });

  it('a build that explains itself is not asked about again', () => {
    setQueue([KLINCEK, GONE, NEXT], 1);
    render(<PlayerProvider>{null}</PlayerProvider>);
    act(() => events!.onError({ trackId: GONE.id, nativeExplains: true }));
    expect(api.getTrackAvailability).not.toHaveBeenCalled();
  });
});

describe('the queue\'s "Couldn\'t play" list and a new queue', () => {
  it('starting a new queue clears it, and the bar\'s message', async () => {
    setQueue([KLINCEK, GONE, NEXT], 1);
    verdict[GONE.id] = { unavailable: true, reason: 'removed' };
    let playTrack: (t: Track, list?: Track[]) => void = () => {};
    function Grab() { playTrack = usePlayer().playTrack; return null; }
    render(<PlayerProvider><Grab /></PlayerProvider>);
    act(() => events!.onError());
    await waitFor(() => expect(useUnplayableStore.getState().couldntPlay).toHaveLength(1));
    expect(bar()).not.toBeNull();
    act(() => playTrack(KLINCEK, [KLINCEK, NEXT]));
    expect(useUnplayableStore.getState().couldntPlay).toEqual([]);
    expect(bar()).toBeNull();
  });
});
