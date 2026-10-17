import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DAILY_MS,
  FAILURE_COOLDOWN_MS,
  createFailureCounter,
  dailyDue,
  failureDue,
  is403Message,
  upgradeEnabled,
} from './upgradePolicy';
import { createUpgradeJob, type UpgradeJobDeps } from './upgradeJob';
import { _resetFailureMemo, forgetUpgradeFixable, recentFailure, rememberTransient, rememberUnavailable } from '@/lib/sources/failureMemo';

const idle = { lastAttemptAt: null, running: false, enabled: true };

describe('policy', () => {
  it('detects 403 text', () => {
    expect(is403Message('HTTP Error 403: Forbidden')).toBe(true);
    expect(is403Message('This video is not available')).toBe(false);
  });
  it('daily: due when never run or a day old, not when running/disabled', () => {
    expect(dailyDue(1000, idle)).toBe(true);
    expect(dailyDue(1000 + DAILY_MS - 1, { ...idle, lastAttemptAt: 1000 })).toBe(false);
    expect(dailyDue(1000 + DAILY_MS, { ...idle, lastAttemptAt: 1000 })).toBe(true);
    expect(dailyDue(1000, { ...idle, running: true })).toBe(false);
    expect(dailyDue(1000, { ...idle, enabled: false })).toBe(false);
  });
  it('failures: needs 3, respects 3h cooldown', () => {
    expect(failureDue(5, 2, idle)).toBe(false);
    expect(failureDue(5, 3, idle)).toBe(true);
    expect(failureDue(1000 + FAILURE_COOLDOWN_MS - 1, 9, { ...idle, lastAttemptAt: 1000 })).toBe(false);
    expect(failureDue(1000 + FAILURE_COOLDOWN_MS, 9, { ...idle, lastAttemptAt: 1000 })).toBe(true);
  });
  it('counter slides over a 10 minute window', () => {
    const c = createFailureCounter();
    expect(c.record(0)).toBe(1);
    expect(c.record(60_000)).toBe(2);
    expect(c.record(11 * 60_000)).toBe(1);
  });
  it('opt-outs', () => {
    expect(upgradeEnabled({})).toBe(true);
    expect(upgradeEnabled({ YTDLP_AUTO_UPGRADE: '0' })).toBe(false);
    expect(upgradeEnabled({ SKIP_YTDLP_UPGRADE: '1' })).toBe(false);
  });
});

describe('job', () => {
  let t: number;
  let saved: number | null;
  let deps: UpgradeJobDeps;
  let run: ReturnType<typeof vi.fn>;
  let log: ReturnType<typeof vi.fn>;
  let after: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    t = 10 * DAILY_MS;
    saved = null;
    run = vi.fn(async () => ({ ok: true, before: '1', after: '2' }));
    log = vi.fn();
    after = vi.fn();
    deps = {
      run: run as unknown as UpgradeJobDeps['run'],
      enabled: () => true,
      now: () => t,
      loadLastAttempt: async () => saved,
      saveLastAttempt: async (ts) => { saved = ts; },
      log: log as unknown as UpgradeJobDeps['log'],
      afterSuccess: after as unknown as UpgradeJobDeps['afterSuccess'],
    };
  });

  it('daily tick runs once, logs versions, clears memo, persists', async () => {
    const job = createUpgradeJob(deps);
    expect(await job.tick()).toBe(true);
    expect(await job.tick()).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('info', 'yt-dlp upgrade finished', expect.objectContaining({ before: '1', after: '2' }));
    expect(after).toHaveBeenCalledTimes(1);
    expect(saved).toBe(t);
  });

  it('respects a marker from a previous process', async () => {
    saved = t - 1000;
    expect(await createUpgradeJob(deps).tick()).toBe(false);
  });

  it('three 403s trigger once, then the 3h cooldown holds', async () => {
    const job = createUpgradeJob(deps);
    expect(await job.noteDownloadFailure('other error')).toBe(false);
    expect(await job.noteDownloadFailure('HTTP Error 403: Forbidden')).toBe(false);
    expect(await job.noteDownloadFailure('HTTP Error 403: Forbidden')).toBe(false);
    expect(await job.noteDownloadFailure('HTTP Error 403: Forbidden')).toBe(true);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    t += 60_000;
    for (let i = 0; i < 5; i++) await job.noteDownloadFailure('HTTP Error 403: Forbidden');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('never two at once', async () => {
    let release!: () => void;
    run.mockImplementation(() => new Promise((r) => { release = () => r({ ok: true, before: null, after: null }); }));
    const job = createUpgradeJob(deps);
    const first = job.tick();
    await vi.waitFor(() => expect(job.isRunning()).toBe(true));
    expect(await job.tick()).toBe(false);
    release();
    await first;
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('failure keeps the memo and logs a warning', async () => {
    run.mockResolvedValue({ ok: false, before: '1', after: null, error: 'boom' });
    await createUpgradeJob(deps).tick();
    expect(after).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('warn', 'yt-dlp upgrade failed', expect.objectContaining({ error: 'boom' }));
  });

  it('missing pip logs once and stops trying', async () => {
    run.mockResolvedValue(null);
    const job = createUpgradeJob(deps);
    await job.tick();
    t += 2 * DAILY_MS;
    await job.tick();
    expect(run).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('times out a hung pip', async () => {
    run.mockImplementation(() => new Promise(() => {}));
    await createUpgradeJob({ ...deps, timeoutMs: 20 }).tick();
    expect(log).toHaveBeenCalledWith('warn', 'yt-dlp upgrade timed out', expect.anything());
  });

  it('disabled does nothing', async () => {
    const job = createUpgradeJob({ ...deps, enabled: () => false });
    expect(await job.tick()).toBe(false);
  });
});

describe('failure memo after upgrade', () => {
  beforeEach(() => _resetFailureMemo());
  it('drops transient and 403 unavailable, keeps real removals', () => {
    rememberTransient('a', 'HTTP Error 403: Forbidden');
    rememberUnavailable('b', 'unavailable', 'HTTP Error 403: Forbidden');
    rememberUnavailable('c', 'removed', 'Video unavailable');
    forgetUpgradeFixable();
    expect(recentFailure('a')).toBeNull();
    expect(recentFailure('b')).toBeNull();
    expect(recentFailure('c')).not.toBeNull();
  });
});
