import { describe, expect, it } from 'vitest';
import { BEAT_WATCHED_MS, PAUSED_GAP_MS, POLL_CONTROLLING_MS, POLL_PICKER_MS, controllerPollDelay, nextBeat } from './cadence';
import { buildSnapshot, lightOf, queueHash, type PlayerStateLike } from './snapshot';
import { clockOffset, extrapolate } from './extrapolate';
import { decideAttach } from './attach';
import { hereHandover, queueForTransfer, remoteHandover } from './handover';
import { TAKEOVER_WINDOW_MS, type RemoteDevice, type Snapshot } from './types';
import { makeTrack } from '@/test-utils/fakeBackend';

// The client's pure rules (W3): when to beat and poll, what a snapshot
// holds, where the remote playhead is now, when to attach, and what moves
// when the music changes device.

const tracks = Array.from({ length: 30 }, (_, i) => makeTrack({ id: `youtube:t${i}`, sourceId: `t${i}`, title: `Song ${i}`, streamUrl: `/s/${i}` }));

const player = (over: Partial<PlayerStateLike> = {}): PlayerStateLike => ({
  queue: tracks, index: 2, position: 40, duration: 191, isPlaying: true, volume: 0.6, muted: false,
  loopMode: 'off', shuffle: false, context: { type: 'liked' }, ...over,
});

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  ...buildSnapshot(player()), at: 10_000, changedAt: 5_000, ...over,
});

describe('cadence', () => {
  it.each([
    [{ hasTrack: true, isPlaying: true, watchers: 1, pausedForMs: 0 }, { delay: BEAT_WATCHED_MS, hold: false }],
    [{ hasTrack: true, isPlaying: true, watchers: 0, pausedForMs: 0 }, { delay: 0, hold: true }],
    [{ hasTrack: true, isPlaying: false, watchers: 3, pausedForMs: 1000 }, { delay: PAUSED_GAP_MS, hold: true }],
    // Watched: never stops, however long it has been paused.
    [{ hasTrack: true, isPlaying: false, watchers: 1, pausedForMs: TAKEOVER_WINDOW_MS * 5 }, { delay: PAUSED_GAP_MS, hold: true }],
    // Paused inside the window: on, even hidden (a minimized player).
    [{ hasTrack: true, isPlaying: false, watchers: 0, pausedForMs: 1000, hidden: true }, { delay: PAUSED_GAP_MS, hold: true }],
    // Idle and on screen: listed and reachable.
    [{ hasTrack: true, isPlaying: false, watchers: 0, pausedForMs: TAKEOVER_WINDOW_MS + 1 }, { delay: PAUSED_GAP_MS, hold: true }],
    [{ hasTrack: false, isPlaying: false, watchers: 0, pausedForMs: 0 }, { delay: PAUSED_GAP_MS, hold: true }],
    // Idle and hidden: nothing.
    [{ hasTrack: true, isPlaying: false, watchers: 0, pausedForMs: TAKEOVER_WINDOW_MS + 1, hidden: true }, null],
    [{ hasTrack: false, isPlaying: false, watchers: 0, pausedForMs: 0, hidden: true }, null],
  ])('beat %o -> %o', (state, want) => {
    expect(nextBeat(state)).toEqual(want);
  });

  it.each([
    [{ controlling: true, pickerOpen: false, hidden: false }, POLL_CONTROLLING_MS],
    [{ controlling: false, pickerOpen: true, hidden: false }, POLL_PICKER_MS],
    [{ controlling: false, pickerOpen: false, hidden: false }, null],
    [{ controlling: true, pickerOpen: true, hidden: true }, null],
  ])('poll %o -> %s', (state, want) => {
    expect(controllerPollDelay(state)).toBe(want);
  });
});

describe('snapshot', () => {
  it('hash is stable across position changes and differs across reorders', () => {
    const a = buildSnapshot(player({ position: 1 }));
    const b = buildSnapshot(player({ position: 99, isPlaying: false }));
    expect(a.queueHash).toBe(b.queueHash);
    const swapped = [...tracks];
    [swapped[3], swapped[4]] = [swapped[4], swapped[3]];
    expect(queueHash(swapped)).not.toBe(a.queueHash);
    expect(queueHash(tracks.slice(0, 29))).not.toBe(a.queueHash);
  });

  it('holds the current song, the next 20 and the queue length, without queue marks', () => {
    const queued = tracks.map((t, i) => (i === 3 ? { ...t, queued: true } : t));
    const s = buildSnapshot(player({ queue: queued }));
    expect(s.track?.id).toBe('youtube:t2');
    expect(s.upNext.map((t) => t.id)).toEqual(tracks.slice(3, 23).map((t) => t.id));
    expect(s.upNext[0]).not.toHaveProperty('queued');
    expect(s.queueLength).toBe(30);
    expect(lightOf(s)).toEqual({ trackId: 'youtube:t2', index: 2, queueHash: s.queueHash, position: 40, duration: 191, isPlaying: true, volume: 0.6, muted: false });
  });

  it('nothing loaded is no track and not playing', () => {
    const s = buildSnapshot(player({ queue: [], index: -1 }));
    expect(s).toMatchObject({ track: null, trackId: null, index: -1, isPlaying: false, upNext: [] });
  });
});

describe('extrapolate', () => {
  it('runs on while playing, by the server clock', () => {
    // offset +2000: the server is 2 s ahead of this device.
    expect(extrapolate(snap({ position: 40, at: 10_000 }), 11_000, 2000)).toBeCloseTo(43);
  });

  it('stops at the song end and does not move while paused', () => {
    expect(extrapolate(snap({ position: 190, duration: 191, at: 0 }), 60_000, 0)).toBe(191);
    expect(extrapolate(snap({ position: 40, isPlaying: false, at: 0 }), 60_000, 0)).toBe(40);
  });

  it('offset from the middle of the request', () => {
    expect(clockOffset(5_000, 1_000, 1_200)).toBe(3_900);
  });
});

describe('decideAttach', () => {
  const dev = (over: Partial<RemoteDevice> = {}): RemoteDevice => ({
    deviceId: 'windows-1', label: 'Windows', platform: 'windows', shell: 'tauri', lastBeat: 0, stale: false, snapshot: snap(), ...over,
  });

  it('an idle phone attaches, a playing one does not', () => {
    expect(decideAttach('phone-1', dev(), false)).toBe('windows-1');
    expect(decideAttach('phone-1', dev(), true)).toBeNull();
  });

  it('never attaches to itself, to nothing, or to a stale device', () => {
    expect(decideAttach('windows-1', dev(), false)).toBeNull();
    expect(decideAttach('phone-1', null, false)).toBeNull();
    expect(decideAttach('phone-1', dev({ stale: true }), false)).toBeNull();
  });

  it('does not go back to a device it just left, until that one changes', () => {
    expect(decideAttach('phone-1', dev(), false, { deviceId: 'windows-1', changedAt: 5_000 })).toBeNull();
    expect(decideAttach('phone-1', dev({ snapshot: snap({ changedAt: 9_000 }) }), false, { deviceId: 'windows-1', changedAt: 5_000 })).toBe('windows-1');
  });
});

describe('handover', () => {
  it('cuts the queue at the current song and caps it', () => {
    expect(queueForTransfer(tracks, 5).tracks.map((t) => t.id)).toEqual(tracks.slice(5).map((t) => t.id));
    expect(queueForTransfer(tracks, 5, 3)).toEqual({ tracks: tracks.slice(5, 8), index: 0 });
    const big = Array.from({ length: 400 }, (_, i) => makeTrack({ id: `youtube:b${i}` }));
    expect(queueForTransfer(big, 10).tracks).toHaveLength(300);
  });

  it('a move to another device keeps the playing state and the position', () => {
    expect(remoteHandover({ queue: tracks, index: 2, position: 40, isPlaying: true, context: { type: 'liked' } })).toEqual({
      tracks: tracks.slice(2), index: 0, play: true, startSec: 40, context: { type: 'liked' },
    });
    expect(remoteHandover({ queue: tracks, index: 2, position: 40, isPlaying: false, context: null })?.play).toBe(false);
    expect(remoteHandover({ queue: [], index: -1, position: 0, isPlaying: false, context: null })).toBeNull();
  });

  it('a move here takes the remote song and up next, at its playhead now, playing if it was', () => {
    const here = hereHandover(snap({ position: 40, at: 10_000 }), 12_000, 0)!;
    expect(here.queue.map((t) => t.id)).toEqual(tracks.slice(2, 23).map((t) => t.id));
    expect(here.startAt).toBeCloseTo(42);
    expect(here.autoplay).toBe(true);
    expect(here.context).toEqual({ type: 'liked' });
    expect(hereHandover(snap({ isPlaying: false, position: 40, at: 0 }), 99_000, 0)).toMatchObject({ startAt: 40, autoplay: false });
  });
});
