import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serverLogger } from './server';
import type { ServerLogEntry } from './types';

// entriesSince/recentSince resolve their directory from EMBER_LOG_DIR on
// every call (see logDir() in server.ts), so a fresh temp dir per test is
// enough isolation without needing to reset modules.
let logDir: string;
const prevEmberLogDir = process.env.EMBER_LOG_DIR;

beforeEach(() => {
  logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-logs-test-'));
  process.env.EMBER_LOG_DIR = logDir;
});

afterEach(() => {
  fs.rmSync(logDir, { recursive: true, force: true });
  if (prevEmberLogDir === undefined) delete process.env.EMBER_LOG_DIR;
  else process.env.EMBER_LOG_DIR = prevEmberLogDir;
});

function writeFile(name: string, entries: ServerLogEntry[]): void {
  fs.writeFileSync(path.join(logDir, name), entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
}

function entry(overrides: Partial<ServerLogEntry> = {}): ServerLogEntry {
  return {
    ts: Date.now(),
    kind: 'error',
    level: 'error',
    category: 'api',
    message: 'boom',
    sessionId: 'server',
    side: 'server',
    reqId: 'req-1',
    route: '/api/test',
    ...overrides,
  };
}

function fileFor(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `errors-${y}-${mo}-${da}.jsonl`;
}

describe('serverLogger.entriesSince (EMBER_LOG_DIR override)', () => {
  it('returns only entries strictly after the given timestamp', async () => {
    const now = Date.now();
    writeFile(fileFor(new Date()), [entry({ ts: now - 1000 }), entry({ ts: now + 1000 })]);
    const out = await serverLogger.entriesSince(now);
    expect(out).toHaveLength(1);
    expect(out[0].ts).toBe(now + 1000);
  });

  it('reads across multiple days when the window spans them', async () => {
    const now = Date.now();
    const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;
    writeFile(fileFor(new Date(twoDaysAgo)), [entry({ ts: twoDaysAgo + 500 })]);
    writeFile(fileFor(new Date()), [entry({ ts: now })]);
    const out = await serverLogger.entriesSince(twoDaysAgo);
    expect(out.length).toBeGreaterThanOrEqual(2);
  });

  it('sorts newest first', async () => {
    const now = Date.now();
    writeFile(fileFor(new Date()), [entry({ ts: now - 3000 }), entry({ ts: now - 1000 }), entry({ ts: now - 2000 })]);
    const out = await serverLogger.entriesSince(now - 10_000);
    expect(out.map((e) => e.ts)).toEqual([now - 1000, now - 2000, now - 3000]);
  });

  it('caps output at 20000 entries', async () => {
    const now = Date.now();
    const many = Array.from({ length: 20_050 }, (_, i) => entry({ ts: now - i }));
    writeFile(fileFor(new Date()), many);
    const out = await serverLogger.entriesSince(now - 30_000);
    expect(out).toHaveLength(20_000);
  }, 15_000);

  it('skips corrupt lines and missing files without throwing', async () => {
    const now = Date.now();
    fs.writeFileSync(
      path.join(logDir, fileFor(new Date())),
      `not json\n${JSON.stringify(entry({ ts: now }))}\n`,
      'utf8',
    );
    const out = await serverLogger.entriesSince(now - 1000);
    expect(out).toHaveLength(1);
  });

  it('returns an empty array when the log dir has nothing in the window', async () => {
    const out = await serverLogger.entriesSince(Date.now());
    expect(out).toEqual([]);
  });
});

describe('boot sweep', () => {
  // ensureDailySweep() only fires once per day (a `lastSweptDayKey` guard),
  // so each test needs its own fresh import to see the sweep run against its
  // own EMBER_LOG_DIR, same pattern as logger/client.test.ts.
  async function freshLogger() {
    vi.resetModules();
    const mod = await import('./server');
    return mod.serverLogger;
  }

  function oldDateDaysAgo(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  it('deletes error log files older than the retention window', async () => {
    const oldFile = fileFor(oldDateDaysAgo(10));
    const recentFile = fileFor(new Date());
    writeFile(oldFile, [entry()]);
    writeFile(recentFile, [entry()]);

    const logger = await freshLogger();
    await logger.entriesSince(Date.now() - 60_000);
    // The sweep is fire-and-forget (void runSweep()); give its promise a
    // turn to settle before checking the filesystem.
    await new Promise((r) => setTimeout(r, 50));

    expect(fs.existsSync(path.join(logDir, oldFile))).toBe(false);
    expect(fs.existsSync(path.join(logDir, recentFile))).toBe(true);
  });

  it('also sweeps stale digest-*.sent markers, not just error logs (T-fix4)', async () => {
    const oldMarker = `digest-${oldDateDaysAgo(10).toISOString().slice(0, 10)}.sent`;
    const recentMarker = `digest-${new Date().toISOString().slice(0, 10)}.sent`;
    fs.writeFileSync(path.join(logDir, oldMarker), 'old\n', 'utf8');
    fs.writeFileSync(path.join(logDir, recentMarker), 'recent\n', 'utf8');

    const logger = await freshLogger();
    await logger.entriesSince(Date.now() - 60_000);
    await new Promise((r) => setTimeout(r, 50));

    expect(fs.existsSync(path.join(logDir, oldMarker))).toBe(false);
    expect(fs.existsSync(path.join(logDir, recentMarker))).toBe(true);
  });

  it('re-sweeps when the day rolls over, not just once at boot (bughunt S11)', async () => {
    const logger = await freshLogger();
    // First call of the (long-lived) process: sweeps immediately, same as
    // before. Nothing old on disk yet, so nothing to delete.
    await logger.entriesSince(Date.now() - 60_000);
    await new Promise((r) => setTimeout(r, 50));

    // A file ages past the retention window while the process keeps running.
    const staleFile = fileFor(oldDateDaysAgo(10));
    writeFile(staleFile, [entry()]);

    // Same calendar day: the old "only at boot" behavior and the fixed
    // behavior agree here, so this call alone wouldn't distinguish them.
    await logger.entriesSince(Date.now() - 60_000);
    await new Promise((r) => setTimeout(r, 50));
    expect(fs.existsSync(path.join(logDir, staleFile))).toBe(true);

    // The day rolls over without the process restarting.
    vi.setSystemTime(new Date(Date.now() + 24 * 60 * 60 * 1000));
    try {
      await logger.entriesSince(Date.now() - 60_000);
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      vi.useRealTimers();
    }

    // Only a re-sweep on the new day catches the now-stale file; a sweep
    // that only ever ran once at boot would leave it forever.
    expect(fs.existsSync(path.join(logDir, staleFile))).toBe(false);
  });
});
