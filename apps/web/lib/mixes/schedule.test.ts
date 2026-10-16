import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNightlyTick, DEFAULT_MIXES_HOUR, mixesHour, mixesMarkerPath, shouldBuildNow } from './schedule';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-mixes-sched-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('mixes schedule', () => {
  it('reads MIXES_HOUR, falling back to 4', () => {
    expect(mixesHour('2')).toBe(2);
    expect(mixesHour('24')).toBe(DEFAULT_MIXES_HOUR);
    expect(mixesHour('x')).toBe(DEFAULT_MIXES_HOUR);
    expect(mixesHour(undefined)).toBe(DEFAULT_MIXES_HOUR);
  });

  it('runs at or after the hour, unless done today', () => {
    expect(shouldBuildNow(new Date('2026-10-16T03:59:00'), 4, false)).toBe(false);
    expect(shouldBuildNow(new Date('2026-10-16T04:00:00'), 4, false)).toBe(true);
    expect(shouldBuildNow(new Date('2026-10-16T23:00:00'), 4, true)).toBe(false);
  });

  it('builds once a day across many ticks, and again the next day', async () => {
    let now = new Date('2026-10-16T04:00:00');
    const build = vi.fn(async () => {});
    const tick = createNightlyTick({ dir, hour: 4, build, now: () => now });
    await tick();
    await tick();
    now = new Date('2026-10-16T22:00:00');
    await tick();
    expect(build).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(mixesMarkerPath(dir, now))).toBe(true);
    now = new Date('2026-10-17T05:00:00');
    await tick();
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('a restart does not build again the same day (the marker is on disk)', async () => {
    const now = new Date('2026-10-16T04:10:00');
    const first = vi.fn(async () => {});
    await createNightlyTick({ dir, hour: 4, build: first, now: () => now })();
    const second = vi.fn(async () => {});
    await createNightlyTick({ dir, hour: 4, build: second, now: () => now })();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('never runs two builds at once, and a failing build only warns', async () => {
    const now = new Date('2026-10-16T04:10:00');
    let release!: () => void;
    const build = vi.fn(() => new Promise<void>((r) => { release = r; }));
    const warn = vi.fn();
    const tick = createNightlyTick({ dir, hour: 4, build, now: () => now, warn });
    const a = tick();
    await new Promise((r) => setTimeout(r, 10));
    expect(await tick()).toBe(false);
    release();
    await a;
    expect(build).toHaveBeenCalledTimes(1);
    const failing = createNightlyTick({ dir: path.join(dir, 'b'), hour: 4, build: async () => { throw new Error('boom'); }, now: () => now, warn });
    await failing();
    expect(warn).toHaveBeenCalledWith('mixes: nightly build failed', { reason: 'boom' });
  });
});
