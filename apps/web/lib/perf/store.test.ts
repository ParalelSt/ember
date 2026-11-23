// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetPerfStore, appendPerf, PERF_STORE_LIMITS, perfFileName, readPerf, sweepPerfStore, type PerfStoreEntry } from './store';
import type { PerfDigest } from './types';

/** The perf store: its own daily files next to the error log, 7 days kept,
 *  a budget per member and per day, read back newest first. */

const DIR = mkdtempSync(join(tmpdir(), 'ember-perf-store-'));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 23, 15, 0);

function digest(over: Partial<PerfDigest> = {}): PerfDigest {
  return { v: 1, session: 's1', seq: 1, t0: NOW - 60_000, app: '0.7.51', shell: 'capacitor', device: { model: 'motorola edge 60' }, fgMs: 300_000, ...over };
}

function entry(over: Partial<PerfStoreEntry> = {}): PerfStoreEntry {
  return { ts: NOW, userId: 'u1', digest: digest(), ...over };
}

beforeEach(() => {
  process.env.EMBER_LOG_DIR = DIR;
  for (const f of readdirSync(DIR)) rmSync(join(DIR, f));
  _resetPerfStore();
});

describe('perf store', () => {
  it('appends to perf-YYYY-MM-DD.jsonl and reads back newest first, filtered', async () => {
    await appendPerf(entry({ ts: NOW - 2000 }), NOW);
    await appendPerf(entry({ ts: NOW - 1000, userId: 'u2', digest: digest({ session: 's2' }) }), NOW);
    expect(existsSync(join(DIR, perfFileName(NOW)))).toBe(true);
    const all = await readPerf(NOW - DAY, undefined, NOW);
    expect(all.map((e) => e.userId)).toEqual(['u2', 'u1']);
    const mine = await readPerf(NOW - DAY, (e) => e.userId === 'u1', NOW);
    expect(mine).toHaveLength(1);
    expect((await readPerf(NOW - 1500, undefined, NOW)).map((e) => e.userId)).toEqual(['u2']);
  });

  it('reads across days and skips corrupt lines', async () => {
    writeFileSync(join(DIR, perfFileName(NOW - DAY)), `${JSON.stringify(entry({ ts: NOW - DAY }))}\nnot json\n{"ts":1}\n`);
    await appendPerf(entry(), NOW);
    const read = await readPerf(NOW - 3 * DAY, undefined, NOW);
    expect(read.map((e) => e.ts)).toEqual([NOW, NOW - DAY]);
  });

  it('caps what one member may add in a day, and starts again the next day', async () => {
    const big = entry({ digest: digest({ device: { model: 'x'.repeat(40) }, api: [['/api/'.repeat(20), 1, 1, 1]] }) });
    const lineBytes = Buffer.byteLength(JSON.stringify(big) + '\n');
    const fits = Math.floor(PERF_STORE_LIMITS.perUserDayBytes / lineBytes);
    let stored = 0;
    for (let i = 0; i < fits + 5; i++) if (await appendPerf(big, NOW)) stored++;
    expect(stored).toBe(fits);
    // Another member still has their own budget.
    expect(await appendPerf(entry({ userId: 'u2' }), NOW)).toBe(true);
    expect(await appendPerf(big, NOW + DAY)).toBe(true);
  });

  it('keeps 7 days, sweeping older files, and never touches the error log', async () => {
    for (const daysAgo of [0, 6, 7, 8, 30]) writeFileSync(join(DIR, perfFileName(NOW - daysAgo * DAY)), '');
    writeFileSync(join(DIR, 'errors-2026-01-01.jsonl'), '');
    await sweepPerfStore(NOW);
    const left = readdirSync(DIR).sort();
    expect(left).toEqual(['errors-2026-01-01.jsonl', perfFileName(NOW - 7 * DAY), perfFileName(NOW - 6 * DAY), perfFileName(NOW)].sort());
  });
});
