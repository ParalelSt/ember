// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { createRemoteStore, decideTakeover, pickActive, type ActiveCandidate, type RemoteStore } from './store';
import { COMMAND_TTL_MS, DROP_MS, STALE_MS, TAKEOVER_WINDOW_MS, type BeatBody, type FullState, type LightState, type RemoteDevice } from './types';
import { makeTrack } from '@/test-utils/fakeBackend';

const T = makeTrack({ id: 'youtube:t1', sourceId: 't1', streamUrl: '/s/t1' });
const U = makeTrack({ id: 'youtube:t2', sourceId: 't2', title: 'Second', streamUrl: '/s/t2' });

const light = (over: Partial<LightState> = {}): LightState => ({
  trackId: T.id, index: 0, queueHash: 'h1', position: 10, duration: 191, isPlaying: true, volume: 0.5, muted: false, ...over,
});
const full = (over: Partial<FullState> = {}): FullState => ({
  ...light(), track: T, upNext: [U], queueLength: 2, loopMode: 'off', shuffle: false, context: null, ...over,
});
const beat = (deviceId: string, body: Partial<BeatBody>): BeatBody => ({
  deviceId, label: deviceId.startsWith('win') ? 'Windows' : 'Android phone',
  platform: deviceId.startsWith('win') ? 'windows' : 'android', shell: 'web', acked: [], ...body,
});

const WIN = 'win-device-1';
const PHONE = 'phone-device-1';
const MAC = 'mac-device-01';

const cand = (deviceId: string, isPlaying: boolean, changedAt: number, lastBeat = 1_000_000): ActiveCandidate => ({
  deviceId, lastBeat, snapshot: { isPlaying, changedAt },
});

describe('pickActive', () => {
  const now = 1_000_000;
  it.each([
    ['playing beats paused', [cand('a', false, now - 1000), cand('b', true, now - 50_000)], 'b'],
    ['newest changedAt wins among playing', [cand('a', true, now - 5000), cand('b', true, now - 1000)], 'b'],
    ['newest paused inside the window', [cand('a', false, now - 5000), cand('b', false, now - 2000)], 'b'],
    ['paused outside the 2 min window is not active', [cand('a', false, now - TAKEOVER_WINDOW_MS - 1)], null],
    ['stale devices are excluded', [cand('a', true, now - 1000, now - STALE_MS - 1)], null],
    ['no snapshot, no device', [{ deviceId: 'a', lastBeat: now, snapshot: null }], null],
  ])('%s', (_name, devices, want) => {
    expect(pickActive(devices as ActiveCandidate[], now)).toBe(want);
  });
});

describe('decideTakeover', () => {
  it('pauses the device that started before me, yields to one that started after', () => {
    const now = 1_000_000;
    expect(decideTakeover([cand('a', true, now - 5000), cand('me', true, now - 1000)], 'me', now)).toEqual({ pause: ['a'], yieldTo: null });
    expect(decideTakeover([cand('a', true, now - 500), cand('me', true, now - 1000)], 'me', now)).toEqual({ pause: [], yieldTo: 'a' });
    expect(decideTakeover([cand('a', true, now - 5000), cand('me', false, now)], 'me', now)).toEqual({ pause: [], yieldTo: null });
  });
});

describe('remote store', () => {
  let store: RemoteStore;
  let now: number;
  beforeEach(() => {
    store = createRemoteStore();
    now = 1_000_000;
  });

  const devicesOf = (user: string, me = 'watcher-device') => store.state(user, me, null, now).devices as RemoteDevice[];

  it('takeover queues exactly one pause to the old device, with who took over', () => {
    store.beat('u1', beat(WIN, { full: full() }), now);
    now += 3000;
    store.beat('u1', beat(PHONE, { full: full() }), now);
    now += 500;
    store.beat('u1', beat(PHONE, { light: light() }), now);
    const answer = store.beat('u1', beat(WIN, { light: light() }), now);
    const pauses = answer.commands.filter((c) => c.type === 'pause');
    expect(pauses).toHaveLength(1);
    expect(pauses[0]).toMatchObject({ type: 'pause', args: { reason: 'took-over', by: 'Android phone' }, issuedBy: null });
    expect(answer.active).toBe(PHONE);
    expect(answer.yield).toEqual({ by: 'Android phone' });
  });

  it('removes acked commands and drops expired ones', () => {
    store.beat('u1', beat(WIN, { full: full() }), now);
    const a = store.command('u1', WIN, PHONE, { type: 'pause' }, now);
    const b = store.command('u1', WIN, PHONE, { type: 'next' }, now);
    expect(a.ok && b.ok).toBe(true);
    let answer = store.beat('u1', beat(WIN, { light: light() }), now);
    expect(answer.commands.map((c) => c.type)).toEqual(['pause', 'next']);
    answer = store.beat('u1', beat(WIN, { light: light(), acked: [(a as { id: string }).id] }), now + 100);
    expect(answer.commands.map((c) => c.type)).toEqual(['next']);
    now += COMMAND_TTL_MS + 1;
    answer = store.beat('u1', beat(WIN, { light: light() }), now);
    expect(answer.commands).toEqual([]);
  });

  it('asks for a full snapshot when a light beat brings a new track, or after a restart', () => {
    expect(store.beat('u1', beat(WIN, { light: light() }), now).want).toBe('full');
    store.beat('u1', beat(WIN, { full: full() }), now);
    expect(store.beat('u1', beat(WIN, { light: light() }), now + 1).want).toBeUndefined();
    expect(store.beat('u1', beat(WIN, { light: light({ trackId: U.id }) }), now + 2).want).toBe('full');
  });

  it('keeps the rev on position-only beats and bumps it on a pause', () => {
    store.beat('u1', beat(WIN, { full: full() }), now);
    const r1 = store.state('u1', PHONE, null, now).rev;
    store.beat('u1', beat(WIN, { light: light({ position: 30 }) }), now + 1000);
    const light1 = store.state('u1', PHONE, r1, now + 1000);
    expect(light1.rev).toBe(r1);
    expect(light1.light).toBe(true);
    expect(light1.devices).toEqual([{ deviceId: WIN, position: 30, isPlaying: true, at: now + 1000 }]);
    store.beat('u1', beat(WIN, { light: light({ position: 31, isPlaying: false }) }), now + 2000);
    const after = store.state('u1', PHONE, r1, now + 2000);
    expect(after.rev).toBeGreaterThan(r1);
    expect(after.light).toBeUndefined();
  });

  it('a second setQueue replaces the first one not run yet', () => {
    store.beat('u1', beat(WIN, { full: full() }), now);
    const args = (tracks = [T]) => ({ tracks, index: 0, play: true, startSec: 0, context: null });
    store.command('u1', WIN, PHONE, { type: 'setQueue', args: args([T]) }, now);
    store.command('u1', WIN, PHONE, { type: 'play' }, now);
    store.command('u1', WIN, PHONE, { type: 'setQueue', args: args([U]) }, now);
    const answer = store.beat('u1', beat(WIN, { light: light() }), now);
    const queues = answer.commands.filter((c) => c.type === 'setQueue');
    expect(queues).toHaveLength(1);
    expect(queues[0].type === 'setQueue' && queues[0].args.tracks[0].id).toBe(U.id);
    expect(answer.commands.map((c) => c.type)).toEqual(['play', 'setQueue']);
  });

  it('refuses commands to a stale or unknown device with 409', () => {
    expect(store.command('u1', WIN, PHONE, { type: 'play' }, now)).toMatchObject({ ok: false, status: 409 });
    store.beat('u1', beat(WIN, { full: full() }), now);
    now += STALE_MS + 1;
    expect(store.command('u1', WIN, PHONE, { type: 'play' }, now)).toEqual({ ok: false, status: 409, error: 'Windows is not reachable' });
  });

  it('lists stale devices as stale, drops them after 10 minutes, never lists me to myself', () => {
    store.beat('u1', beat(WIN, { full: full() }), now);
    expect(devicesOf('u1', WIN)).toEqual([]);
    now += STALE_MS + 1;
    expect(devicesOf('u1')).toEqual([expect.objectContaining({ deviceId: WIN, stale: true })]);
    now += DROP_MS;
    expect(devicesOf('u1')).toEqual([]);
  });

  it('counts watchers other than the player', () => {
    store.beat('u1', beat(WIN, { full: full() }), now);
    expect(store.beat('u1', beat(WIN, { light: light() }), now).watchers).toBe(0);
    store.state('u1', PHONE, null, now);
    store.state('u1', WIN, null, now);
    expect(store.beat('u1', beat(WIN, { light: light() }), now + 1000).watchers).toBe(1);
    expect(store.beat('u1', beat(WIN, { light: light() }), now + 7000).watchers).toBe(0);
  });

  it('keeps accounts apart', () => {
    store.beat('u1', beat(WIN, { full: full() }), now);
    store.beat('u2', beat(MAC, { full: full() }), now);
    expect(devicesOf('u2').map((d) => d.deviceId)).toEqual([MAC]);
    expect(store.command('u2', WIN, null, { type: 'pause' }, now)).toMatchObject({ ok: false, status: 409 });
  });

  it('a device that controls another plays nothing, whatever its last beat said', () => {
    store.beat('u1', beat(PHONE, { full: full() }), now);
    store.beat('u1', beat(WIN, { full: full() }), now + 1000);
    const before = store.state('u1', MAC, null, now + 1000);
    const r = before.rev;
    store.state('u1', PHONE, null, now + 1500, WIN);
    const after = store.state('u1', MAC, r, now + 1500);
    expect(after.rev).toBeGreaterThan(r);
    expect((after.devices as RemoteDevice[]).find((d) => d.deviceId === PHONE)?.snapshot?.isPlaying).toBe(false);
    expect(after.active).toBe(WIN);
  });

  it('a took-over pause from before the device started again is dropped', () => {
    store.beat('u1', beat(WIN, { full: full() }), now);
    store.beat('u1', beat(PHONE, { full: full() }), now + 1000);
    // Windows paused by the takeover, then (the music moved back) plays again.
    store.beat('u1', beat(WIN, { light: light({ isPlaying: false }) }), now + 30_000);
    const answer = store.beat('u1', beat(WIN, { light: light({ isPlaying: true }), acked: [] }), now + 31_000);
    expect(answer.commands.filter((c) => c.type === 'pause')).toEqual([]);
  });
});
