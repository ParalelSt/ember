import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRemoteLink, type RemoteIdentity, type RemoteLinkActions } from './useRemoteLink';
import { BEAT_UNWATCHED_MS, BEAT_WATCHED_MS } from '@/lib/remote/cadence';
import type { BeatAnswer, BeatBody, RemoteCommand } from '@/lib/remote/types';
import { makeTrack } from '@/test-utils/fakeBackend';
import { usePlayerStore } from '@/stores/usePlayerStore';

// The player's link (W4): beats on its cadence and at once on a change,
// runs each command once and acknowledges it, follows setQueue, yields when
// another device took over, backs off on 429.

const A = makeTrack({ id: 'youtube:a', sourceId: 'a', title: 'A', streamUrl: '/s/a' });
const B = makeTrack({ id: 'youtube:b', sourceId: 'b', title: 'B', streamUrl: '/s/b' });
const identity: RemoteIdentity = { deviceId: 'windows-device', label: 'Windows', platform: 'windows', shell: 'tauri' };

type Beat = (body: BeatBody) => Promise<BeatAnswer>;
const answer = (over: Partial<BeatAnswer> = {}): BeatAnswer => ({ now: Date.now(), commands: [], watchers: 0, active: identity.deviceId, ...over });
const command = (over: Partial<RemoteCommand> & Pick<RemoteCommand, 'type'>): RemoteCommand =>
  ({ id: `c${Math.random().toString(36).slice(2, 8)}`, issuedBy: 'phone-device', issuedAt: 0, expiresAt: Date.now() + 20_000, ...over }) as RemoteCommand;

type FakeActions = { [K in keyof RemoteLinkActions]: Mock<RemoteLinkActions[K]> };

function actions(): FakeActions {
  return {
    play: vi.fn(), pause: vi.fn(), next: vi.fn(), prev: vi.fn(), seek: vi.fn(),
    playAt: vi.fn(), playTrack: vi.fn(), requestStartAt: vi.fn(),
  };
}

/** A fake server: each beat gets the next queued answer, else a plain one. */
function server(...answers: Array<BeatAnswer | Error>) {
  const queue = [...answers];
  return vi.fn<Beat>(async () => {
    const next = queue.shift() ?? answer();
    if (next instanceof Error) throw next;
    return next;
  });
}

function setup(beat: Beat, a = actions(), notify = vi.fn()) {
  const actionsRef = { current: a };
  renderHook(() => useRemoteLink({ enabled: true, identity, actionsRef, beat, notify }));
  return { a, notify };
}

beforeEach(() => {
  vi.useFakeTimers();
  usePlayerStore.setState({ queue: [A, B], index: 0, isPlaying: true, position: 5, duration: 191, volume: 0.5, muted: false, loopMode: 'off', shuffle: false, context: null });
});
afterEach(() => vi.useRealTimers());

describe('useRemoteLink', () => {
  it('beats at once with the full state, then every 10 s, every 1.5 s once watched', async () => {
    const beat = server(answer(), answer({ watchers: 1 }));
    setup(beat);
    await vi.advanceTimersByTimeAsync(0);
    expect(beat).toHaveBeenCalledTimes(1);
    expect(beat.mock.calls[0][0]).toMatchObject({ deviceId: 'windows-device', full: { trackId: A.id, isPlaying: true } });
    await vi.advanceTimersByTimeAsync(BEAT_UNWATCHED_MS - 100);
    expect(beat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(beat).toHaveBeenCalledTimes(2);
    // Same song and queue: a light beat now.
    expect(beat.mock.calls[1][0].light).toBeDefined();
    await vi.advanceTimersByTimeAsync(BEAT_WATCHED_MS);
    expect(beat).toHaveBeenCalledTimes(3);
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
    await vi.advanceTimersByTimeAsync(BEAT_UNWATCHED_MS);
    expect(beat.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(a.next).toHaveBeenCalledTimes(1);
  });

  it('setQueue plays the list from the index at the start position, paused when play is false', async () => {
    const ctx = { type: 'playlist' as const, playlistId: 'p1', playlistName: 'Mix' };
    const beat = server(answer({ commands: [command({ type: 'setQueue', args: { tracks: [A, B], index: 1, play: false, startSec: 33, context: ctx } })] }));
    const { a } = setup(beat);
    await vi.advanceTimersByTimeAsync(0);
    expect(a.requestStartAt).toHaveBeenCalledWith(33);
    expect(a.playTrack).toHaveBeenCalledWith(B, [A, B], ctx, { autoplay: false });
    expect(a.requestStartAt.mock.invocationCallOrder[0]).toBeLessThan(a.playTrack.mock.invocationCallOrder[0]);
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
    await vi.advanceTimersByTimeAsync(BEAT_UNWATCHED_MS);
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
});
