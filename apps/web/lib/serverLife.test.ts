import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UNCLEAN_GAP_MS, fmtDuration, judgePreviousRun, parseHeartbeat } from './serverLife';

const hb = (o: object = {}) => ({ ts: 1_000_000, startedAt: 400_000, pid: 1, ...o });

describe('judgePreviousRun', () => {
  it('first start without a file', () => {
    expect(judgePreviousRun(null, 5)).toEqual({ kind: 'first' });
  });
  it('clean stop', () => {
    expect(judgePreviousRun(hb({ stopped: true }), 1_030_000)).toEqual({ kind: 'clean', uptimeMs: 600_000, downMs: 30_000 });
  });
  it('unclean when heartbeat is older than 2 minutes', () => {
    const r = judgePreviousRun(hb(), 1_000_000 + UNCLEAN_GAP_MS + 1);
    expect(r).toMatchObject({ kind: 'unclean', gapMs: UNCLEAN_GAP_MS + 1, uptimeMs: 600_000 });
  });
  it('exactly 2 minutes is still a quick restart', () => {
    expect(judgePreviousRun(hb(), 1_000_000 + UNCLEAN_GAP_MS).kind).toBe('quick-restart');
  });
  it('a clean stop wins however long the gap', () => {
    expect(judgePreviousRun(hb({ stopped: true }), 99_999_999).kind).toBe('clean');
  });
});

describe('parseHeartbeat / fmtDuration', () => {
  it('rejects junk', () => {
    expect(parseHeartbeat('nope')).toBeNull();
    expect(parseHeartbeat('{"ts":1}')).toBeNull();
    expect(parseHeartbeat('{"ts":2,"startedAt":1,"pid":3,"stopped":true}')).toMatchObject({ stopped: true });
  });
  it('formats', () => {
    expect(fmtDuration(30_000)).toBe('30s');
    expect(fmtDuration(10 * 60_000)).toBe('10m');
    expect(fmtDuration(3 * 3600_000)).toBe('3.0h');
  });
});

describe('startServerLife: the stop marker stays the last word', () => {
  const added: [NodeJS.Signals, (...a: unknown[]) => void][] = [];
  afterEach(() => {
    for (const [sig, fn] of added.splice(0)) process.removeListener(sig, fn);
    vi.useRealTimers();
  });

  // Next keeps the process alive after SIGTERM until its open requests end
  // (an audio stream: until the watchdog's SIGKILL 8 s later). A heartbeat
  // that fired in that time wrote over the "stopped" marker, so a stop for
  // an update whose build took a few minutes read as an unclean shutdown in
  // the next digest.
  it('a heartbeat after the stop signal does not erase the stop', async () => {
    vi.resetModules();
    const { startServerLife, heartbeatPath, HEARTBEAT_MS } = await import('./serverLife');
    const dir = mkdtempSync(join(tmpdir(), 'ember-life-'));
    // Another SIGTERM listener (Next's own), so the handler does not re-send
    // the signal to this test process.
    const keep = () => {};
    process.on('SIGTERM', keep);
    added.push(['SIGTERM', keep]);
    const before = { SIGTERM: process.listeners('SIGTERM'), SIGINT: process.listeners('SIGINT') };
    vi.useFakeTimers();
    try {
      const log = { info: vi.fn(), warn: vi.fn(), infoSync: vi.fn() };
      await startServerLife({ dir, version: 't', log });
      for (const sig of ['SIGTERM', 'SIGINT'] as const) {
        for (const fn of process.listeners(sig)) if (!before[sig].includes(fn)) added.push([sig, fn as (...a: unknown[]) => void]);
      }

      process.emit('SIGTERM');
      expect(JSON.parse(readFileSync(heartbeatPath(dir), 'utf8')).stopped).toBe(true);

      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2);
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 50));
      expect(JSON.parse(readFileSync(heartbeatPath(dir), 'utf8'))).toMatchObject({ stopped: true, signal: 'SIGTERM' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
