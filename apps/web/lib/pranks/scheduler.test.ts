import { beforeEach, describe, expect, it } from 'vitest';
import type { RecentPrank } from './limits';
import { checkSchedule, nextFire, runTick, type ScheduleRow, type TickPrank, type TickStore } from './scheduler';

const NOW = Date.UTC(2026, 8, 23, 20, 0, 0);
const MIN = 60_000;

interface Fake {
  store: TickStore;
  schedules: (ScheduleRow & { active: boolean })[];
  written: TickPrank[];
  history: (RecentPrank & { target: string; issuedBy: string })[];
  playing: Set<string>;
  sounds: Map<string, string>;
  on: { value: boolean };
  expiredCalls: number[];
}

function fake(): Fake {
  const f: Fake = {
    schedules: [],
    written: [],
    history: [],
    playing: new Set(['marko']),
    sounds: new Map([['quack', '/api/pranks/media/quack']]),
    on: { value: true },
    expiredCalls: [],
    store: null as never,
  };
  f.store = {
    enabled: async () => f.on.value,
    due: async (now) => f.schedules.filter((s) => s.active && s.nextFireAt <= now).map((s) => ({ ...s })),
    recent: async (target, admin) => ({
      forTarget: f.history.filter((h) => h.target === target),
      byAdmin: f.history.filter((h) => h.issuedBy === admin),
    }),
    isPlaying: (target) => f.playing.has(target),
    soundUrl: async (id) => f.sounds.get(id) ?? null,
    createPrank: async (row) => {
      f.written.push(row);
      f.history.push({ kind: 'sound', status: row.status, reason: row.reason, created: NOW, target: row.target, issuedBy: row.issuedBy });
    },
    updateSchedule: async (id, patch) => {
      Object.assign(f.schedules.find((s) => s.id === id)!, patch);
    },
    expireStale: async (now) => {
      f.expiredCalls.push(now);
      return 2;
    },
  };
  return f;
}

const schedule = (over: Partial<ScheduleRow & { active: boolean }> = {}) => ({
  id: 'sc1', target: 'marko', issuedBy: 'root', sound: 'quack', params: { mode: 'duck', volume: 0.5 },
  intervalSec: 120, endsAt: NOW + 60 * MIN, nextFireAt: NOW, fired: 0, active: true, ...over,
});

let f: Fake;
beforeEach(() => {
  f = fake();
});

describe('runTick', () => {
  it('fires a due schedule: one pending sound row, fired counted, next fire one interval on', async () => {
    f.schedules.push(schedule());
    const { results, expired } = await runTick(NOW, f.store);
    expect(results).toEqual([{ id: 'sc1', result: 'fired' }]);
    expect(expired).toBe(2);
    expect(f.written).toEqual([{
      target: 'marko', issuedBy: 'root', schedule: 'sc1', sound: 'quack', status: 'pending', reason: '',
      params: { durationSec: 30, volume: 0.5, mode: 'duck', startFrom: 'start', streamUrl: '/api/pranks/media/quack' },
      expiresAt: NOW + 45_000,
    }]);
    expect(f.schedules[0]).toMatchObject({ fired: 1, nextFireAt: NOW + 2 * MIN, active: true });
  });

  it('leaves a schedule that is not due yet alone', async () => {
    f.schedules.push(schedule({ nextFireAt: NOW + 1000 }));
    const { results } = await runTick(NOW, f.store);
    expect(results).toEqual([]);
    expect(f.written).toEqual([]);
    expect(f.schedules[0]).toMatchObject({ fired: 0, nextFireAt: NOW + 1000 });
  });

  it('expires stale pending rows on every tick, due schedules or not', async () => {
    await runTick(NOW, f.store);
    expect(f.expiredCalls).toEqual([NOW]);
  });

  it('skips when their music is not playing: logged as skipped, not counted, schedule moves on', async () => {
    f.playing.clear();
    f.schedules.push(schedule());
    const { results } = await runTick(NOW, f.store);
    expect(results).toEqual([{ id: 'sc1', result: 'not-playing' }]);
    expect(f.written).toHaveLength(1);
    expect(f.written[0]).toMatchObject({ status: 'skipped', reason: 'not-playing', schedule: 'sc1' });
    expect(f.schedules[0]).toMatchObject({ fired: 0, nextFireAt: NOW + 2 * MIN, active: true });
  });

  it('a not-playing skip does not count against the hourly cap', async () => {
    // 19 heard this hour plus 5 skipped: one more still goes out.
    for (let i = 0; i < 19; i++) f.history.push({ kind: 'sound', status: 'done', created: NOW - (i + 1) * MIN, target: 'marko', issuedBy: 'x' });
    for (let i = 0; i < 5; i++) {
      f.history.push({ kind: 'sound', status: 'skipped', reason: 'not-playing', created: NOW - 30_000, target: 'marko', issuedBy: 'x' });
    }
    f.schedules.push(schedule());
    expect((await runTick(NOW, f.store)).results).toEqual([{ id: 'sc1', result: 'fired' }]);
  });

  it('holds off when the person has had 20 this hour, retrying when the cap frees up', async () => {
    for (let i = 0; i < 20; i++) f.history.push({ kind: 'sound', status: 'done', created: NOW - (i + 1) * MIN, target: 'marko', issuedBy: 'x' });
    f.schedules.push(schedule());
    const { results } = await runTick(NOW, f.store);
    expect(results).toEqual([{ id: 'sc1', result: 'capped', reason: 'target-hourly' }]);
    expect(f.written).toEqual([]);
    // The oldest of the 20 is 20 min old: it leaves the hour in 40 min.
    expect(f.schedules[0]).toMatchObject({ fired: 0, nextFireAt: NOW + 40 * MIN, active: true });
  });

  it('waits out the 15 s gap after another sound, a few seconds later', async () => {
    f.history.push({ kind: 'sound', status: 'done', created: NOW - 5000, target: 'marko', issuedBy: 'x' });
    f.schedules.push(schedule());
    const { results } = await runTick(NOW, f.store);
    expect(results).toEqual([{ id: 'sc1', result: 'capped', reason: 'sound-gap' }]);
    expect(f.schedules[0].nextFireAt).toBe(NOW + 10_000);
  });

  it('stops a capped schedule whose retry would land after its stop time', async () => {
    for (let i = 0; i < 20; i++) f.history.push({ kind: 'sound', status: 'done', created: NOW - (i + 1) * MIN, target: 'marko', issuedBy: 'x' });
    f.schedules.push(schedule({ endsAt: NOW + 10 * MIN }));
    await runTick(NOW, f.store);
    expect(f.schedules[0].active).toBe(false);
  });

  it('turns every due schedule off while the switch is off, writing nothing', async () => {
    f.on.value = false;
    f.schedules.push(schedule(), schedule({ id: 'sc2', target: 'ivana' }));
    const { results } = await runTick(NOW, f.store);
    expect(results.map((r) => r.result)).toEqual(['switched-off', 'switched-off']);
    expect(f.written).toEqual([]);
    expect(f.schedules.every((s) => !s.active)).toBe(true);
  });

  it('ends a schedule once its stop time has passed', async () => {
    f.schedules.push(schedule({ endsAt: NOW - 1000, nextFireAt: NOW - 5000 }));
    const { results } = await runTick(NOW, f.store);
    expect(results).toEqual([{ id: 'sc1', result: 'ended' }]);
    expect(f.written).toEqual([]);
    expect(f.schedules[0].active).toBe(false);
  });

  it('the last fire before the stop time also ends the schedule', async () => {
    f.schedules.push(schedule({ endsAt: NOW + MIN }));
    const { results } = await runTick(NOW, f.store);
    expect(results).toEqual([{ id: 'sc1', result: 'fired' }]);
    expect(f.schedules[0]).toMatchObject({ active: false, fired: 1 });
  });

  it('ends a schedule whose sound left the library', async () => {
    f.sounds.clear();
    f.schedules.push(schedule());
    expect((await runTick(NOW, f.store)).results).toEqual([{ id: 'sc1', result: 'sound-gone' }]);
    expect(f.schedules[0].active).toBe(false);
  });

  it('never fires twice for one person in one tick: the second waits out the gap', async () => {
    f.schedules.push(schedule(), schedule({ id: 'sc2', nextFireAt: NOW - 1000 }));
    const { results } = await runTick(NOW, f.store);
    expect(results).toEqual([
      { id: 'sc2', result: 'fired' },
      { id: 'sc1', result: 'capped', reason: 'sound-gap' },
    ]);
    expect(f.written).toHaveLength(1);
  });

  it('a schedule far behind plays once and carries on from now', async () => {
    f.schedules.push(schedule({ nextFireAt: NOW - 30 * MIN }));
    await runTick(NOW, f.store);
    expect(f.written).toHaveLength(1);
    expect(f.schedules[0].nextFireAt).toBe(NOW + 2 * MIN);
  });
});

describe('nextFire', () => {
  it('steps one interval, never into the past', () => {
    expect(nextFire(NOW, 60, NOW)).toBe(NOW + MIN);
    expect(nextFire(NOW - 10 * MIN, 60, NOW)).toBe(NOW + MIN);
  });
});

describe('checkSchedule', () => {
  const at = (ms: number) => new Date(ms).toISOString();
  it('takes every 60 s to 2 h, until a time up to 2 h away', () => {
    expect(checkSchedule(60, at(NOW + 30 * MIN), NOW)).toEqual({ ok: true, intervalSec: 60, endsAt: NOW + 30 * MIN });
    expect(checkSchedule(7200, at(NOW + 120 * MIN), NOW)).toMatchObject({ ok: true });
  });
  it('refuses intervals under a minute or over 2 h, in words', () => {
    expect(checkSchedule(59, at(NOW + 30 * MIN), NOW)).toEqual({ ok: false, error: 'Repeat every 1 minute to 2 hours' });
    expect(checkSchedule(7201, at(NOW + 30 * MIN), NOW)).toMatchObject({ ok: false });
    expect(checkSchedule('5', at(NOW + 30 * MIN), NOW)).toMatchObject({ ok: false });
  });
  it('refuses a stop time in the past, over 2 h away, or before the second play', () => {
    expect(checkSchedule(60, at(NOW - 1000), NOW)).toEqual({ ok: false, error: 'Pick a stop time in the future' });
    expect(checkSchedule(60, at(NOW + 125 * MIN), NOW)).toEqual({ ok: false, error: 'A repeat can run for 2 hours at most' });
    expect(checkSchedule(600, at(NOW + 5 * MIN), NOW)).toEqual({ ok: false, error: 'The stop time is sooner than the second play' });
    expect(checkSchedule(60, 'soon', NOW)).toMatchObject({ ok: false });
  });
});
