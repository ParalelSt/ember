import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRemoteBackend, isRemoteBackend, type RemoteLink } from './remoteBackend';
import type { AudioBackendEvents } from './types';
import { buildSnapshot } from '@/lib/remote/snapshot';
import type { CommandBody, Snapshot } from '@/lib/remote/types';
import { makeTrack } from '@/test-utils/fakeBackend';

// The engine that plays on another device (W5): each control posts one
// command and shows at once; a snapshot that still disagrees after 4 s
// takes it back; snapshots drive the provider's events.

const tracks = Array.from({ length: 400 }, (_, i) => makeTrack({ id: `youtube:t${i}`, sourceId: `t${i}`, title: `Song ${i}`, streamUrl: `/s/${i}` }));

function snapshotOf(over: Partial<Snapshot> = {}, index = 0): Snapshot {
  const full = buildSnapshot({
    queue: tracks.slice(0, 30), index, position: 10, duration: 191, isPlaying: true, volume: 0.5, muted: false,
    loopMode: 'off', shuffle: false, context: { type: 'liked' },
  });
  return { ...full, at: Date.now(), changedAt: Date.now(), ...over };
}

function setup(initial: Snapshot | null = snapshotOf()) {
  let snap = initial;
  const subs = new Set<() => void>();
  const send = vi.fn<(c: CommandBody) => Promise<unknown>>(async () => ({ id: 'x' }));
  const notify = vi.fn();
  const link: RemoteLink = {
    label: () => 'Windows',
    snapshot: () => snap,
    offset: () => 0,
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    send,
    notify,
  };
  const events = {
    onTime: vi.fn(), onDuration: vi.fn(), onEnded: vi.fn(), onPlay: vi.fn(), onPause: vi.fn(), onError: vi.fn(),
    onQueueIndex: vi.fn(), onQueueReplaced: vi.fn(), onShuffle: vi.fn(), onLoopMode: vi.fn(),
  } satisfies AudioBackendEvents;
  const b = createRemoteBackend(events, link);
  const push = (next: Snapshot) => {
    snap = next;
    for (const cb of subs) cb();
  };
  return { b, events, send, notify, push };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

describe('remote backend', () => {
  it('is a remote backend', () => {
    expect(isRemoteBackend(setup().b)).toBe(true);
  });

  it('adopting fires the queue, index, duration, loop, shuffle and play state', () => {
    const { b, events } = setup();
    b.adopt();
    expect(events.onQueueReplaced).toHaveBeenCalledTimes(1);
    const [list, index, info] = events.onQueueReplaced.mock.calls[0];
    expect(list.map((t: { id: string }) => t.id)).toEqual(tracks.slice(0, 21).map((t) => t.id));
    expect(index).toBe(0);
    expect(info).toEqual({ shuffle: false, context: { type: 'liked' } });
    expect(events.onQueueIndex).toHaveBeenCalledWith(0);
    expect(events.onDuration).toHaveBeenCalledWith(191);
    expect(events.onLoopMode).toHaveBeenCalledWith('off');
    expect(events.onShuffle).toHaveBeenCalledWith(false, { initial: true });
    expect(events.onPlay).toHaveBeenCalled();
    expect(b.isPaused()).toBe(false);
  });

  it('each control posts the right command once', () => {
    const { b, send } = setup();
    b.adopt();
    b.pause();
    b.play();
    b.next!();
    b.prev!();
    b.seek(20);
    b.setLoop!('all');
    b.setShuffle!(true);
    b.playAt(3);
    expect(send.mock.calls.map((c) => c[0])).toEqual([
      { type: 'pause' }, { type: 'play' }, { type: 'next' }, { type: 'prev' },
      { type: 'seek', args: { sec: 20 } }, { type: 'setLoop', args: { mode: 'all' } },
      { type: 'setShuffle', args: { on: true } }, { type: 'playAt', args: { index: 3 } },
    ]);
  });

  it('a mode the snapshot brought is not sent back, and only a volume change goes', () => {
    const { b, send } = setup();
    b.adopt();
    b.setLoop!('off');
    b.setShuffle!(false);
    b.setVolume(0.7);
    b.setVolume(0.7);
    expect(send).not.toHaveBeenCalled();
    b.setVolume(0.3);
    expect(send).toHaveBeenCalledWith({ type: 'setVolume', args: { volume: 0.3 } });
  });

  it('setQueue posts a capped list cut at the index', () => {
    const { b, send } = setup();
    b.adopt();
    b.setQueue!(tracks, 50, true, { context: { type: 'liked' }, baseCount: 400 });
    const cmd = send.mock.calls[0][0];
    expect(cmd.type).toBe('setQueue');
    if (cmd.type !== 'setQueue') return;
    expect(cmd.args.tracks).toHaveLength(300);
    expect(cmd.args.tracks[0].id).toBe('youtube:t50');
    expect(cmd.args).toMatchObject({ index: 0, play: true, startSec: 0, context: { type: 'liked' } });
  });

  it('a playAt maps the mirror entry to the remote queue', () => {
    const { b, send } = setup(snapshotOf({}, 7));
    b.adopt();
    b.playAt(2);
    expect(send).toHaveBeenCalledWith({ type: 'playAt', args: { index: 9 } });
  });

  it('applies a pause at once, and takes it back if the device still plays after 4 s', () => {
    const { b, events, notify, push } = setup();
    b.adopt();
    events.onPlay.mockClear();
    b.pause();
    expect(events.onPause).toHaveBeenCalledTimes(1);
    expect(b.isTransitioning()).toBe(true);
    // A snapshot before the device got it: held.
    vi.advanceTimersByTime(1500);
    push(snapshotOf({ isPlaying: true }));
    expect(b.isPaused()).toBe(true);
    expect(events.onPlay).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2600);
    push(snapshotOf({ isPlaying: true }));
    expect(b.isPaused()).toBe(false);
    expect(events.onPlay).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('Windows did not respond');
  });

  it('a snapshot that agrees settles the command', () => {
    const { b, notify, push } = setup();
    b.adopt();
    b.pause();
    vi.advanceTimersByTime(1500);
    push(snapshotOf({ isPlaying: false }));
    expect(b.isTransitioning()).toBe(false);
    vi.advanceTimersByTime(5000);
    push(snapshotOf({ isPlaying: false }));
    expect(notify).not.toHaveBeenCalled();
  });

  it('says so when the device is not reachable, and goes back to its state', async () => {
    const { b, send, notify } = setup();
    b.adopt();
    send.mockRejectedValueOnce(Object.assign(new Error('Windows is not reachable'), { status: 409 }));
    b.pause();
    await vi.advanceTimersByTimeAsync(0);
    expect(notify).toHaveBeenCalledWith('Windows is not reachable');
    expect(b.isPaused()).toBe(false);
  });

  it('a new track in the snapshot replaces the queue with its 20 and moves the index', () => {
    const { b, events, push } = setup();
    b.adopt();
    events.onQueueReplaced.mockClear();
    events.onQueueIndex.mockClear();
    push(snapshotOf({}, 1));
    expect(events.onQueueReplaced).toHaveBeenCalledTimes(1);
    expect(events.onQueueReplaced.mock.calls[0][0]).toHaveLength(21);
    expect(events.onQueueReplaced.mock.calls[0][0][0].id).toBe('youtube:t1');
    expect(events.onQueueIndex).toHaveBeenCalledWith(0);
    // The same state again replaces nothing.
    push(snapshotOf({ position: 50 }, 1));
    expect(events.onQueueReplaced).toHaveBeenCalledTimes(1);
  });

  it('runs the playhead on between polls, stops at the end and while paused', () => {
    const { b, events, push } = setup(snapshotOf({ position: 10, at: 1_000_000 }));
    b.adopt();
    vi.advanceTimersByTime(2000);
    expect(b.getCurrentTime()).toBeCloseTo(12);
    expect(events.onTime).toHaveBeenLastCalledWith(expect.closeTo(12, 1));
    push(snapshotOf({ position: 190, at: Date.now() }));
    vi.advanceTimersByTime(5000);
    expect(b.getCurrentTime()).toBe(191);
    push(snapshotOf({ position: 30, isPlaying: false, at: Date.now() }));
    vi.advanceTimersByTime(5000);
    expect(b.getCurrentTime()).toBe(30);
  });

  it('sends no events after destroy', () => {
    const { b, events, push } = setup();
    b.adopt();
    b.destroy();
    for (const fn of Object.values(events)) fn.mockClear();
    push(snapshotOf({}, 3));
    vi.advanceTimersByTime(3000);
    for (const fn of Object.values(events)) expect(fn).not.toHaveBeenCalled();
  });
});
