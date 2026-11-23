// @vitest-environment node
// Node, not happy-dom: server code, and the attached file's name is read
// back off the multipart body.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Never a real channel, even if a mock fails to intercept.
vi.hoisted(() => {
  process.env.DISCORD_BUG_REPORT_WEBHOOK_URL = 'http://127.0.0.1:4312/hook';
});

vi.mock('@/lib/logger/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logger/server')>();
  return { ...actual, serverLogger: { ...actual.serverLogger, error: vi.fn() } };
});

const {
  anonHash,
  createPerfRollupTick,
  readRollupState,
  rollupFile,
  rollupSalt,
  ROLLUP_PERIOD_MS,
  runPerfRollup,
  runScheduledRollup,
  shouldPostNow,
  windowEnd,
} = await import('./perfRollupJob');
const { perfFileName } = await import('@/lib/perf/store');
const { buildPlatformRollup } = await import('@/lib/perf/platformRollup');

const LOG_DIR = mkdtempSync(join(tmpdir(), 'ember-perf-rollup-'));
afterAll(() => rmSync(LOG_DIR, { recursive: true, force: true }));

const H = 60 * 60 * 1000;
const SLOT = Date.UTC(2026, 10, 23, 12);
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  rmSync(LOG_DIR, { recursive: true, force: true });
  process.env.EMBER_LOG_DIR = LOG_DIR;
  process.env.DISCORD_BUG_REPORT_WEBHOOK_URL = 'http://127.0.0.1:4312/hook';
  delete process.env.DISCORD_PERF_WEBHOOK_URL;
  delete process.env.DISCORD_PERF_THREAD_ID;
  delete process.env.EMBER_PERF_LOG;
  delete process.env.PERF_ROLLUP_SALT;
  delete process.env.PERF_ROLLUP_DISABLED;
  fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

/** Writes batches into the perf store's day file, as the route does. */
function writeBatches(lines: { ts: number; userId: string; session: string; os?: string; extra?: Record<string, unknown> }[]) {
  mkdirSync(LOG_DIR, { recursive: true });
  const byFile = new Map<string, string[]>();
  for (const l of lines) {
    const file = join(LOG_DIR, perfFileName(l.ts));
    const digest = { v: 1, session: l.session, seq: 1, t0: l.ts - 1000, app: '0.7.51', shell: 'capacitor', ...(l.os ? { os: l.os } : {}), device: {}, fgMs: 300_000, ...l.extra };
    byFile.set(file, [...(byFile.get(file) ?? []), JSON.stringify({ ts: l.ts, userId: l.userId, digest })]);
  }
  for (const [file, rows] of byFile) writeFileSync(file, rows.join('\n') + '\n');
}

function posted(i = 0): { url: string; payload: { content: string; embeds: { title: string }[] }; fileName: string } {
  const [url, init] = fetchMock.mock.calls[i];
  const form = init.body as FormData;
  const blob = form.get('files[0]') as File;
  return { url, payload: JSON.parse(form.get('payload_json') as string), fileName: blob.name };
}

async function postedFile(i = 0): Promise<Record<string, unknown>> {
  const form = fetchMock.mock.calls[i][1].body as FormData;
  return JSON.parse(await (form.get('files[0]') as File).text());
}

describe('the schedule', () => {
  it('windows are fixed 6 hour slots in UTC', () => {
    expect(windowEnd(SLOT + 5 * H + 59 * 60_000)).toBe(SLOT);
    expect(windowEnd(SLOT)).toBe(SLOT);
  });

  it('posts the window that just ended once, retrying a failed post a few times, 30 min apart', () => {
    const now = SLOT + 60_000;
    const start = SLOT - ROLLUP_PERIOD_MS;
    expect(shouldPostNow(now, { lastWindow: 0 })).toBe(true);
    expect(shouldPostNow(now, { lastWindow: start - ROLLUP_PERIOD_MS })).toBe(true);
    expect(shouldPostNow(now, { lastWindow: start })).toBe(false);
    expect(shouldPostNow(now, { lastWindow: 0, failWindow: start, failCount: 1, failLast: now - 60_000 })).toBe(false);
    expect(shouldPostNow(now, { lastWindow: 0, failWindow: start, failCount: 1, failLast: now - 31 * 60_000 })).toBe(true);
    expect(shouldPostNow(now, { lastWindow: 0, failWindow: start, failCount: 3, failLast: 0 })).toBe(false);
  });
});

describe('runScheduledRollup', () => {
  it('posts the slot that ended, records it, and does not post it again (a restart included)', async () => {
    writeBatches([
      { ts: SLOT - 2 * H, userId: 'u1', session: 'a', os: 'android' },
      { ts: SLOT - 1 * H, userId: 'u2', session: 'b', os: 'windows' },
      // Outside the window: before it, and in the slot still running.
      { ts: SLOT - 7 * H, userId: 'u3', session: 'c', os: 'linux' },
      { ts: SLOT + 1000, userId: 'u3', session: 'd', os: 'linux' },
    ]);
    const res = await runScheduledRollup(SLOT + 2 * 60_000);
    expect(res?.posted).toBe(true);
    expect(res?.rollup.totals.byOs).toMatchObject({ android: 1, windows: 1, linux: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const p = posted();
    expect(p.payload.embeds).toHaveLength(5);
    expect(p.payload.embeds[0].title).toBe('Android · 2026-11-23 06:00 to 12:00 UTC');
    expect(p.fileName).toBe('perf-rollup.json');
    expect(await readRollupState()).toEqual({ lastWindow: SLOT - ROLLUP_PERIOD_MS });

    expect(await runScheduledRollup(SLOT + 3 * 60_000)).toBeNull();
    expect(await runScheduledRollup(SLOT + 5 * H)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('posts into the perf thread of the bug-report webhook, or to DISCORD_PERF_WEBHOOK_URL when set', async () => {
    writeBatches([{ ts: SLOT - H, userId: 'u1', session: 'a', os: 'android' }]);
    await runScheduledRollup(SLOT + 60_000);
    expect(posted(0).url).toBe('http://127.0.0.1:4312/hook?thread_id=1574541246045618378');

    process.env.DISCORD_PERF_WEBHOOK_URL = 'http://127.0.0.1:4312/perf';
    await runPerfRollup({ now: SLOT });
    expect(posted(1).url).toBe('http://127.0.0.1:4312/perf');
  });

  it('skips a window with no sessions at all, and marks it done', async () => {
    const res = await runScheduledRollup(SLOT + 60_000);
    expect(res?.reason).toBe('quiet');
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await readRollupState()).lastWindow).toBe(SLOT - ROLLUP_PERIOD_MS);
  });

  it('does nothing at all with EMBER_PERF_LOG=off', async () => {
    writeBatches([{ ts: SLOT - H, userId: 'u1', session: 'a', os: 'android' }]);
    process.env.EMBER_PERF_LOG = 'off';
    expect(await runScheduledRollup(SLOT + 60_000)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(existsSync(join(LOG_DIR, 'perf-rollup-state.json'))).toBe(false);
  });

  it('with no webhook at all, posts nothing and marks the window done', async () => {
    writeBatches([{ ts: SLOT - H, userId: 'u1', session: 'a', os: 'android' }]);
    delete process.env.DISCORD_BUG_REPORT_WEBHOOK_URL;
    const res = await runScheduledRollup(SLOT + 60_000);
    expect(res?.reason).toBe('no-webhook');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries a refused post up to 3 times, then gives the window up', async () => {
    writeBatches([{ ts: SLOT - H, userId: 'u1', session: 'a', os: 'android' }]);
    fetchMock.mockResolvedValue(new Response('nope', { status: 400 }));
    const t = SLOT + 60_000;
    expect((await runScheduledRollup(t))?.reason).toBe('post-failed');
    expect(await runScheduledRollup(t + 60_000)).toBeNull();
    expect((await runScheduledRollup(t + 31 * 60_000))?.reason).toBe('post-failed');
    expect((await runScheduledRollup(t + 62 * 60_000))?.reason).toBe('post-failed');
    expect(await runScheduledRollup(t + 120 * 60_000)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((await readRollupState()).lastWindow).toBe(SLOT - ROLLUP_PERIOD_MS);
  });

  it('never throws when the network does', async () => {
    writeBatches([{ ts: SLOT - H, userId: 'u1', session: 'a', os: 'android' }]);
    fetchMock.mockRejectedValue(new Error('offline'));
    expect((await runScheduledRollup(SLOT + 60_000))?.reason).toBe('post-failed');
  });
});

describe('createPerfRollupTick', () => {
  it('never runs twice at once and never throws', async () => {
    let release!: () => void;
    const run = vi.fn(() => new Promise<void>((r) => (release = r)));
    const tick = createPerfRollupTick({ now: () => SLOT, run });
    const first = tick();
    await tick();
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await first;
    const failing = createPerfRollupTick({ now: () => SLOT, run: async () => { throw new Error('boom'); } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(failing()).resolves.toBeUndefined();
    warn.mockRestore();
  });
});

describe('runPerfRollup (the admin side)', () => {
  it('a dry run builds everything and posts nothing, records nothing', async () => {
    writeBatches([{ ts: SLOT - H, userId: 'u1', session: 'a', os: 'android' }]);
    const res = await runPerfRollup({ now: SLOT, dryRun: true });
    expect(res).toMatchObject({ posted: false, reason: 'dry-run', webhook: 'bug-report-thread' });
    expect(res.file.totals.sessions).toBe(1);
    expect(res.message.embeds).toHaveLength(5);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(existsSync(join(LOG_DIR, 'perf-rollup-state.json'))).toBe(false);
  });

  it('a manual post does not take the scheduled window', async () => {
    writeBatches([{ ts: SLOT - H, userId: 'u1', session: 'a', os: 'android' }]);
    expect((await runPerfRollup({ now: SLOT + 60_000 })).posted).toBe(true);
    expect((await runScheduledRollup(SLOT + 60_000))?.posted).toBe(true);
  });

  it('the file has the numbers and per-session rows with no member id, session id or email', async () => {
    writeBatches([
      { ts: SLOT - H, userId: 'secretuserid01', session: 'secret-session-1', os: 'android', extra: { heap: { used: 40 } } },
      { ts: SLOT - H, userId: 'secretuserid02', session: 'secret-session-2', os: 'macos', extra: { shell: 'web' } },
    ]);
    await runPerfRollup({ now: SLOT });
    const file = await postedFile();
    expect(file).toMatchObject({ totals: { sessions: 2, members: 2 }, sessionsOmitted: 0 });
    expect((file.platforms as unknown[]).length).toBe(6);
    const sessions = file.sessions as { member: string; session: string }[];
    expect(sessions).toHaveLength(2);
    expect(sessions[0].member).toMatch(/^[0-9a-f]{10}$/);
    expect(sessions[0].member).not.toBe(sessions[1].member);
    const text = JSON.stringify(file) + JSON.stringify(posted().payload);
    for (const secret of ['secretuserid01', 'secretuserid02', 'secret-session-1', 'secret-session-2', '@']) expect(text).not.toContain(secret);
  });
});

describe('the salt and the hashes', () => {
  it('uses PERF_ROLLUP_SALT, else makes one per host under logs/ and keeps it', async () => {
    process.env.PERF_ROLLUP_SALT = 'from-env';
    expect(await rollupSalt()).toBe('from-env');
    delete process.env.PERF_ROLLUP_SALT;
    const made = await rollupSalt();
    expect(made).toMatch(/^[0-9a-f]{64}$/);
    expect(await rollupSalt()).toBe(made);
    const file = join(LOG_DIR, 'perf-rollup-salt');
    expect(readFileSync(file, 'utf8').trim()).toBe(made);
    expect(statSync(file).mode & 0o077).toBe(0);
  });

  it('same id and salt, same hash; a different salt, a different one', () => {
    expect(anonHash('s1', 'member', 'u1')).toBe(anonHash('s1', 'member', 'u1'));
    expect(anonHash('s1', 'member', 'u1')).not.toBe(anonHash('s2', 'member', 'u1'));
    expect(anonHash('s1', 'member', 'u1')).not.toBe(anonHash('s1', 'session', 'u1'));
  });
});

describe('rollupFile', () => {
  it('drops the oldest sessions to stay near the cap, and says how many', () => {
    const rollup = buildPlatformRollup([], 0, 1);
    const row = { session: 'x', member: 'y', os: 'android', shell: 'phone app', app: '1', device: {}, first: 0, last: 0, batches: 1, missing: 0, fgMs: 0, nav: { n: 0, p50: 0, p95: 0, max: 0 }, longTaskMs: 0, freezes: { n: 0, max: 0 }, rage: 0, slowTaps: 0, sideNav: { taps: 0, abandoned: 0 } } as const;
    const sessions = Array.from({ length: 5000 }, (_, i) => ({ ...row, session: `s${i}`, device: { model: 'm'.repeat(40) } }));
    const file = rollupFile(rollup, sessions as never, 200_000);
    expect(Buffer.byteLength(JSON.stringify(file))).toBeLessThanOrEqual(200_000);
    expect(file.sessions.length + file.sessionsOmitted).toBe(5000);
    expect(file.sessions[0].session).toBe('s0');
    expect(file.sessionsOmitted).toBeGreaterThan(0);
  });
});
