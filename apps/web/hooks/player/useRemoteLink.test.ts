import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { renderHook } from '@testing-library/react';
import { LINK_LOCK, TAB_INSTANCE, useRemoteLink, type RemoteIdentity, type RemoteLinkActions } from './useRemoteLink';
import { BEAT_WATCHED_MS, PAUSED_GAP_MS } from '@/lib/remote/cadence';
import { HOLD_MS } from '@/lib/remote/types';
import type { BeatAnswer, BeatBody, RemoteCommand } from '@/lib/remote/types';
import { makeTrack } from '@/test-utils/fakeBackend';
import { usePlayerStore } from '@/stores/usePlayerStore';

// The player's link (W4): beats on its cadence and at once on a change,
// runs each command once and acknowledges it, follows setQueue, yields when
// another device took over, backs off on 429.

const A = makeTrack({ id: 'youtube:a', sourceId: 'a', title: 'A', streamUrl: '/s/a' });
const B = makeTrack({ id: 'youtube:b', sourceId: 'b', title: 'B', streamUrl: '/s/b' });
const identity: RemoteIdentity = { deviceId: 'windows-device', label: 'Windows', platform: 'windows', shell: 'tauri' };

type Beat = (body: BeatBody, signal?: AbortSignal) => Promise<BeatAnswer>;
const answer = (over: Partial<BeatAnswer> = {}): BeatAnswer => ({ now: Date.now(), commands: [], watchers: 0, active: identity.deviceId, ...over });
const command = (over: Partial<RemoteCommand> & Pick<RemoteCommand, 'type'>): RemoteCommand =>
  ({ id: `c${Math.random().toString(36).slice(2, 8)}`, issuedBy: 'phone-device', issuedAt: 0, expiresAt: Date.now() + 20_000, ...over }) as RemoteCommand;

type FakeActions = { [K in keyof RemoteLinkActions]: Mock<RemoteLinkActions[K]> };

function actions(): FakeActions {
  return {
    play: vi.fn(), pause: vi.fn(), next: vi.fn(), prev: vi.fn(), seek: vi.fn(),
    playAt: vi.fn(), playTrack: vi.fn(), playQueue: vi.fn(),
  };
}

/** An answer the server gives a held beat after `ms` (news arrived). */
const after = (ms: number, a: BeatAnswer = answer()) => ({ ms, a });
type Planned = BeatAnswer | Error | ReturnType<typeof after>;

/** A fake server: each beat gets the next queued answer, else a plain one.
 *  A held beat with no news planned is answered after HOLD_MS; an abort
 *  ends it. `holding` turns holding on (a real server holds). */
function server(...answers: Planned[]) {
  const queue = [...answers];
  const fn = vi.fn<Beat>((body, signal) => {
    const next = queue.shift();
    if (next instanceof Error) return Promise.reject(next);
    const planned = next && 'ms' in next ? next : null;
    const reply = planned ? planned.a : (next as BeatAnswer | undefined) ?? answer();
    const wait = planned ? planned.ms : body.hold && fn.holding ? HOLD_MS : 0;
    if (!wait) return Promise.resolve(reply);
    return new Promise<BeatAnswer>((resolve, reject) => {
      const t = setTimeout(() => resolve(reply), wait);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    });
  }) as ReturnType<typeof vi.fn<Beat>> & { holding: boolean };
  fn.holding = false;
  return fn;
}

type Locks = NonNullable<Parameters<typeof useRemoteLink>[0]['locks']>;

function setup(beat: Beat, a = actions(), notify = vi.fn(), extra: { locks?: Locks | null; beacon?: (url: string, body: Blob) => boolean } = {}) {
  const actionsRef = { current: a };
  const hook = renderHook(() => useRemoteLink({ enabled: true, identity, actionsRef, beat, notify, locks: null, ...extra }));
  return { a, notify, hook };
}

/** A Web Lock another tab holds until `release()`. */
function lockHeldElsewhere() {
  let release: () => void = () => {};
  const elsewhere = new Promise<void>((r) => { release = r; });
  const request = vi.fn(async (name: string, _opts: { signal?: AbortSignal }, cb: () => Promise<void>) => {
    expect(name).toBe(LINK_LOCK);
    await elsewhere;
    await cb();
  });
  return { locks: { request } as unknown as Locks, release: () => release() };
}

beforeEach(() => {
  vi.useFakeTimers();
  usePlayerStore.setState({ queue: [A, B], index: 0, isPlaying: true, position: 5, duration: 191, volume: 0.5, muted: false, loopMode: 'off', shuffle: false, context: null });
});
afterEach(() => vi.useRealTimers());

describe('useRemoteLink', () => {
  it('while nobody watches, one held beat at a time, back to back', async () => {
    const beat = server();
    beat.holding = true;
    setup(beat);
    await vi.advanceTimersByTimeAsync(0);
    expect(beat).toHaveBeenCalledTimes(1);
    expect(beat.mock.calls[0][0]).toMatchObject({ deviceId: 'windows-device', hold: true, full: { trackId: A.id, isPlaying: true } });
    await vi.advanceTimersByTimeAsync(HOLD_MS - 100);
    expect(beat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(beat).toHaveBeenCalledTimes(2);
    // Same song and queue: a light beat now, held again.
    expect(beat.mock.calls[1][0]).toMatchObject({ hold: true });
    expect(beat.mock.calls[1][0].light).toBeDefined();
  });

  it('a watcher answers the held beat at once; then a plain beat every 1.5 s', async () => {
    const beat = server(after(200, answer({ watchers: 1 })), answer({ watchers: 1 }), answer({ watchers: 1 }));
    setup(beat);
    await vi.advanceTimersByTimeAsync(200);
    expect(beat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(BEAT_WATCHED_MS);
    expect(beat).toHaveBeenCalledTimes(2);
    expect(beat.mock.calls[1][0].hold).toBeUndefined();
    await vi.advanceTimersByTimeAsync(BEAT_WATCHED_MS);
    expect(beat).toHaveBeenCalledTimes(3);
  });

  it('a held beat that comes straight back is not held again for 1.5 s', async () => {
    const beat = server();
    setup(beat);
    await vi.advanceTimersByTimeAsync(0);
    expect(beat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(BEAT_WATCHED_MS - 100);
    expect(beat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(beat).toHaveBeenCalledTimes(2);
  });

  it('a change here cuts the held beat short and beats with it', async () => {
    const beat = server();
    beat.holding = true;
    setup(beat);
    await vi.advanceTimersByTimeAsync(0);
    usePlayerStore.setState({ isPlaying: false });
    await vi.advanceTimersByTimeAsync(700);
    expect(beat).toHaveBeenCalledTimes(2);
    const sent = beat.mock.calls[1][0];
    expect((sent.light ?? sent.full)?.isPlaying).toBe(false);
  });

  it('paused: a held beat, then 10 s, then the next', async () => {
    usePlayerStore.setState({ isPlaying: false });
    const beat = server(answer(), answer());
    setup(beat);
    await vi.advanceTimersByTimeAsync(0);
    expect(beat.mock.calls[0][0]).toMatchObject({ hold: true });
    await vi.advanceTimersByTimeAsync(PAUSED_GAP_MS - 100);
    expect(beat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(beat).toHaveBeenCalledTimes(2);
  });

  it('a pause command runs once and is acknowledged on the next beat', async () => {
    const pause = command({ type: 'pause' });
    const beat = server(answer({ commands: [pause] }));
    const { a } = setup(beat);
    await vi.advanceTimersByTimeAsync(0);
    expect(a.pause).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(400);
    expect(beat).toHaveBeenCalledTimes(2);
    expect(beat.mock.calls[1][0].acked).toEqual([pause.id]);
  });

  it('a command delivered twice runs once', async () => {
    const next = command({ type: 'next' });
    const beat = server(answer({ commands: [next] }), answer({ commands: [next] }));
    const { a } = setup(beat);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(400);
    await vi.advanceTimersByTimeAsync(BEAT_WATCHED_MS * 2);
    expect(beat.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(a.next).toHaveBeenCalledTimes(1);
  });

  it('setQueue plays the list from the index at the start position, paused when play is false', async () => {
    const ctx = { type: 'playlist' as const, playlistId: 'p1', playlistName: 'Mix' };
    const beat = server(answer({ commands: [command({ type: 'setQueue', args: { tracks: [A, B], index: 1, play: false, startSec: 33, context: ctx } })] }));
    const { a } = setup(beat);
    await vi.advanceTimersByTimeAsync(0);
    // Its own path, not playTrack: the list and the entry as sent.
    expect(a.playQueue).toHaveBeenCalledWith([A, B], 1, ctx, { autoplay: false, startAt: 33 });
    expect(a.playTrack).not.toHaveBeenCalled();
  });

  it('store commands land in the player store', async () => {
    const beat = server(answer({ commands: [
      command({ type: 'setVolume', args: { volume: 0.9 } }),
      command({ type: 'setLoop', args: { mode: 'one' } }),
      command({ type: 'addToQueue', args: { tracks: [B] } }),
    ] }));
    setup(beat);
    await vi.advanceTimersByTimeAsync(0);
    const st = usePlayerStore.getState();
    expect(st.volume).toBe(0.9);
    expect(st.loopMode).toBe('one');
    expect(st.queue.map((t) => t.id)).toEqual([A.id, B.id, B.id]);
  });

  it('yields with a toast when another device took over', async () => {
    const beat = server(answer({ yield: { by: 'Android phone' }, commands: [command({ type: 'pause', args: { reason: 'took-over', by: 'Android phone' } })] }));
    const { a, notify } = setup(beat);
    await vi.advanceTimersByTimeAsync(0);
    expect(a.pause).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('Paused: playing on Android phone');
  });

  it('backs off after a 429', async () => {
    const limited = Object.assign(new Error('Slow down'), { status: 429, retryAfterMs: 30_000 });
    const beat = server(limited);
    setup(beat);
    await vi.advanceTimersByTimeAsync(0);
    expect(beat).toHaveBeenCalledTimes(1);
    // A state change inside the wait does not beat.
    usePlayerStore.setState({ isPlaying: false });
    await vi.advanceTimersByTimeAsync(29_000);
    expect(beat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(beat).toHaveBeenCalledTimes(2);
  });

  it('sends the full state when the server asks for it', async () => {
    const beat = server(answer(), answer({ want: 'full' }));
    setup(beat);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(BEAT_WATCHED_MS);
    expect(beat.mock.calls[1][0].light).toBeDefined();
    await vi.advanceTimersByTimeAsync(400);
    expect(beat).toHaveBeenCalledTimes(3);
    expect(beat.mock.calls[2][0].full).toBeDefined();
  });

  it('beats at once on a change, and while the page is hidden', async () => {
    const beat = server();
    setup(beat);
    await vi.advanceTimersByTimeAsync(0);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    try {
      usePlayerStore.setState({ isPlaying: false });
      await vi.advanceTimersByTimeAsync(400);
      expect(beat).toHaveBeenCalledTimes(2);
      expect(beat.mock.calls[1][0].light?.isPlaying).toBe(false);
    } finally {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    }
  });

  it('says which tab it is', async () => {
    const beat = server();
    setup(beat);
    await vi.advanceTimersByTimeAsync(0);
    expect(beat.mock.calls[0][0].instance).toBe(TAB_INSTANCE);
  });

  it('waits while another tab of the browser holds the lock, and takes over when it goes', async () => {
    const beat = server();
    const other = lockHeldElsewhere();
    setup(beat, actions(), vi.fn(), { locks: other.locks });
    await vi.advanceTimersByTimeAsync(5000);
    expect(beat).not.toHaveBeenCalled();
    other.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(beat).toHaveBeenCalledTimes(1);
  });

  it('says goodbye with a beacon when the page goes away', async () => {
    const beat = server();
    const beacon = vi.fn<(url: string, body: Blob) => boolean>(() => true);
    setup(beat, actions(), vi.fn(), { beacon });
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event('pagehide'));
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, blob] = beacon.mock.calls[0];
    expect(url).toMatch(/\/api\/remote\/beat$/);
    const sent = JSON.parse(await blob.text());
    expect(sent).toMatchObject({ deviceId: 'windows-device', instance: TAB_INSTANCE, bye: true, light: { isPlaying: false } });
  });

  it('an open, idle app beats too (held, every 10 s or so), but not while hidden', async () => {
    usePlayerStore.setState({ queue: [], index: -1, isPlaying: false });
    const beat = server(answer(), answer());
    setup(beat);
    await vi.advanceTimersByTimeAsync(0);
    expect(beat).toHaveBeenCalledTimes(1);
    expect(beat.mock.calls[0][0]).toMatchObject({ hold: true, full: { track: null } });
    await vi.advanceTimersByTimeAsync(PAUSED_GAP_MS + 100);
    expect(beat).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    try {
      // The beat already planned goes out; after it, nothing.
      await vi.advanceTimersByTimeAsync(PAUSED_GAP_MS + 100);
      const n = beat.mock.calls.length;
      await vi.advanceTimersByTimeAsync(PAUSED_GAP_MS * 3);
      expect(beat).toHaveBeenCalledTimes(n);
    } finally {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    }
  });

  it('a watched device paused for long keeps beating, so it never goes stale', async () => {
    usePlayerStore.setState({ isPlaying: false });
    const beat = server(answer({ watchers: 1 }), answer({ watchers: 1 }), answer({ watchers: 1 }));
    setup(beat);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(beat.mock.calls.length).toBeGreaterThan(10);
  });
});

