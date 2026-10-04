// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkTriageConfig, resetTriageConfigNote, triageBugReport, type TriageInput } from '@/lib/ai/triage';
import { serverLogger } from '@/lib/logger/server';
import { groupForDigest } from './digest';

/** The digest noise from the 2026-10-04 report, end to end through the real
 *  server logger: the routine lines ("tab lined up", the missing AI key, a
 *  failed triage call) are written to the JSONL on disk the way the app
 *  writes them, and the digest built from that file must not list them,
 *  while a real problem logged next to them still shows. */

const INPUT: TriageInput = {
  note: '',
  client: { current: [], previous: [], sessionId: 'session-1' },
  server: [],
  userAgent: 'test-agent',
  context: undefined,
};

let logDir: string;
const prevLogDir = process.env.EMBER_LOG_DIR;
const prevKey = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  resetTriageConfigNote();
  logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-digest-noise-'));
  process.env.EMBER_LOG_DIR = logDir;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fs.rmSync(logDir, { recursive: true, force: true });
  if (prevLogDir === undefined) delete process.env.EMBER_LOG_DIR;
  else process.env.EMBER_LOG_DIR = prevLogDir;
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = prevKey;
});

describe('the daily digest and routine log lines', () => {
  it('counts none of: tab lined up, the missing AI key, a failed triage call; still counts a real error', async () => {
    const since = Date.now() - 1000;

    // What lib/tabAlign.ts writes when a tab lines up (its level is pinned
    // by lib/tabAlign.test.ts).
    serverLogger.info('tabs', 'tab lined up', { tab: 't1', offsetMs: 10, bpm: 100, confidence: 0.9, bars: 4 });

    // No key: startup note plus two reports, one line in all.
    delete process.env.ANTHROPIC_API_KEY;
    checkTriageConfig();
    await triageBugReport(INPUT);
    await triageBugReport(INPUT);

    // A key, but the model call fails.
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('network down'))));
    await triageBugReport(INPUT);

    serverLogger.error('api', 'a real problem');

    // The logger appends fire-and-forget; wait for all four lines to land.
    let entries: Awaited<ReturnType<typeof serverLogger.entriesSince>> = [];
    await vi.waitFor(async () => {
      entries = await serverLogger.entriesSince(since);
      expect(entries).toHaveLength(4);
    }, { timeout: 10_000 });

    const byMessage = Object.fromEntries(entries.map((e) => [e.message, e.level]));
    expect(byMessage).toEqual({
      'tab lined up': 'info',
      'ANTHROPIC_API_KEY is not set: bug reports will arrive without AI triage': 'info',
      'triage failed': 'warn',
      'a real problem': 'error',
    });

    const groups = groupForDigest(entries, since);
    expect(groups.map((g) => g.example.message)).toEqual(['a real problem']);
  }, 20_000);
});
