// @vitest-environment node
// Node, not happy-dom: this is server code, and happy-dom's FormData drops
// the filename passed with a Blob, which is what the digest.json assertion
// below reads.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerLogEntry } from '@/lib/logger/types';

// Never the real channel, even if a mock ever fails to intercept: the job
// reads this on every call, so setting it before the module loads is enough.
vi.hoisted(() => {
  process.env.DISCORD_BUG_REPORT_WEBHOOK_URL = 'http://127.0.0.1:4312/hook';
});

// The log reader and the model call are the two things the job leans on;
// everything else (grouping, formatting, the marker file) runs for real.
vi.mock('@/lib/logger/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logger/server')>();
  return {
    ...actual,
    serverLogger: { ...actual.serverLogger, entriesSince: vi.fn(async () => [] as ServerLogEntry[]), error: vi.fn() },
  };
});
vi.mock('@/lib/ai/triage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/triage')>();
  return { ...actual, summarizeDigest: vi.fn(async () => null), isTriageConfigured: vi.fn(() => true) };
});

const { digestHour, markerExists, markerPath, runDigest, shouldRunNow } = await import('./digestJob');
const { serverLogger } = await import('@/lib/logger/server');
const { isTriageConfigured, summarizeDigest } = await import('@/lib/ai/triage');

const LOG_DIR = mkdtempSync(join(tmpdir(), 'ember-digest-'));
afterAll(() => rmSync(LOG_DIR, { recursive: true, force: true }));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EMBER_LOG_DIR = LOG_DIR;
  delete process.env.DIGEST_HOUR;
  vi.mocked(isTriageConfigured).mockReturnValue(true);
  vi.mocked(summarizeDigest).mockResolvedValue(null);
  fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

function entry(over: Partial<ServerLogEntry> = {}): ServerLogEntry {
  return {
    ts: Date.now() - 60_000,
    kind: 'error',
    level: 'error',
    category: 'api',
    message: 'GET /api/youtube/stream/abc123 -> 502',
    sessionId: 'server',
    side: 'server',
    reqId: 'r1',
    route: '/api/youtube/stream',
    ...over,
  };
}

/** The Discord embed the job built, parsed back out of the multipart body. */
function postedEmbed(): { title: string; description: string; footer: { text: string }; fields: { name: string; value: string }[] } {
  const form = fetchMock.mock.calls[0][1].body as FormData;
  return JSON.parse(form.get('payload_json') as string).embeds[0];
}

describe('shouldRunNow', () => {
  it('waits for the configured hour', () => {
    expect(shouldRunNow(new Date(2026, 8, 13, 7, 59), 8, false)).toBe(false);
    expect(shouldRunNow(new Date(2026, 8, 13, 8, 0), 8, false)).toBe(true);
  });

  it('still runs later in the day, so a host asleep at the hour catches up', () => {
    expect(shouldRunNow(new Date(2026, 8, 13, 22, 30), 8, false)).toBe(true);
  });

  it('never runs twice on a day whose marker is already there', () => {
    expect(shouldRunNow(new Date(2026, 8, 13, 8, 0), 8, true)).toBe(false);
    expect(shouldRunNow(new Date(2026, 8, 13, 23, 59), 8, true)).toBe(false);
  });

  it('honours a non-default hour', () => {
    expect(shouldRunNow(new Date(2026, 8, 13, 2, 0), 3, false)).toBe(false);
    expect(shouldRunNow(new Date(2026, 8, 13, 3, 0), 3, false)).toBe(true);
  });
});

describe('digestHour', () => {
  it('defaults to 8', () => {
    expect(digestHour()).toBe(8);
  });

  it('reads DIGEST_HOUR', () => {
    process.env.DIGEST_HOUR = '3';
    expect(digestHour()).toBe(3);
    process.env.DIGEST_HOUR = '0';
    expect(digestHour()).toBe(0);
  });

  it('falls back to 8 rather than disabling itself on a bad value', () => {
    process.env.DIGEST_HOUR = 'nine';
    expect(digestHour()).toBe(8);
    process.env.DIGEST_HOUR = '99';
    expect(digestHour()).toBe(8);
    process.env.DIGEST_HOUR = '-1';
    expect(digestHour()).toBe(8);
  });
});

describe('runDigest', () => {
  it('posts nothing on a quiet day', async () => {
    vi.mocked(serverLogger.entriesSince).mockResolvedValue([]);

    const result = await runDigest();

    expect(result).toMatchObject({ posted: false, reason: 'quiet' });
    expect(result.groups).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(summarizeDigest).not.toHaveBeenCalled();
  });

  it('reads the log exactly once per run', async () => {
    vi.mocked(serverLogger.entriesSince).mockResolvedValue([entry(), entry({ reqId: 'r2' })]);

    await runDigest();

    expect(serverLogger.entriesSince).toHaveBeenCalledTimes(1);
  });

  it('groups repeated occurrences of one bug into one line and posts them', async () => {
    const now = Date.now();
    vi.mocked(serverLogger.entriesSince).mockResolvedValue([
      entry({ ts: now - 60_000, message: 'GET /api/youtube/stream/aaa -> 502' }),
      entry({ ts: now - 50_000, message: 'GET /api/youtube/stream/bbb -> 502' }),
      entry({ ts: now - 40_000, message: 'GET /api/youtube/stream/ccc -> 502' }),
      entry({ ts: now - 30_000, category: 'python', route: '/api/search', message: 'yt-dlp exited 1' }),
    ]);

    const result = await runDigest({ now });

    expect(result.posted).toBe(true);
    // Three stream failures differing only by video id are one bug.
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].count).toBe(3);

    const embed = postedEmbed();
    expect(embed.title).toMatch(/^Daily error digest \d{4}-\d{2}-\d{2}$/);
    const errors = embed.fields.find((f) => f.name === 'Errors');
    expect(errors?.value).toContain('```');
    expect(errors?.value).toContain('3x');
    expect(errors?.value).toContain('yt-dlp exited 1');
  });

  it('attaches the full grouping as digest.json', async () => {
    vi.mocked(serverLogger.entriesSince).mockResolvedValue([entry()]);

    await runDigest();

    const form = fetchMock.mock.calls[0][1].body as FormData;
    const file = form.get('files[0]') as File;
    expect(file.name).toBe('digest.json');
    const payload = JSON.parse(await file.text());
    expect(payload.groups).toHaveLength(1);
    expect(payload.since).toMatch(/T/);
  });

  it('uses the model headline and lines when the summary comes back', async () => {
    vi.mocked(serverLogger.entriesSince).mockResolvedValue([entry()]);
    vi.mocked(summarizeDigest).mockResolvedValue({
      headline: '1 problem since yesterday, top: YouTube stream 502s',
      lines: ['Stream proxy returned 502 once', 'Check yt-dlp version'],
    });

    await runDigest();

    const embed = postedEmbed();
    expect(embed.description).toBe('1 problem since yesterday, top: YouTube stream 502s');
    expect(embed.fields.find((f) => f.name === 'What to look at')?.value).toContain('Check yt-dlp version');
  });

  it('still posts the groups when the model call fails, and says so', async () => {
    vi.mocked(serverLogger.entriesSince).mockResolvedValue([entry()]);
    vi.mocked(summarizeDigest).mockResolvedValue(null);

    const result = await runDigest();

    expect(result.posted).toBe(true);
    const embed = postedEmbed();
    expect(embed.description).toContain('distinct problem');
    expect(embed.fields.some((f) => f.name === 'What to look at')).toBe(false);
    expect(embed.footer.text).toContain('AI summary unavailable');
  });

  it('says the key is missing rather than blaming the model', async () => {
    vi.mocked(serverLogger.entriesSince).mockResolvedValue([entry()]);
    vi.mocked(isTriageConfigured).mockReturnValue(false);

    await runDigest();

    expect(postedEmbed().footer.text).toContain('no ANTHROPIC_API_KEY');
  });

  it('scrubs secrets out of the example message before it leaves the host', async () => {
    vi.mocked(serverLogger.entriesSince).mockResolvedValue([
      entry({ message: 'auth refresh failed with pb_auth=eyJhbGciOiJIUzI1NiJ9.secret' }),
    ]);

    await runDigest();

    const posted = (fetchMock.mock.calls[0][1].body as FormData).get('payload_json') as string;
    expect(posted).not.toContain('eyJhbGciOiJIUzI1NiJ9.secret');
    expect(posted).toContain('[scrubbed]');
  });

  it('reports a rejected webhook instead of claiming it posted', async () => {
    vi.mocked(serverLogger.entriesSince).mockResolvedValue([entry()]);
    fetchMock.mockResolvedValue(new Response('too big', { status: 400 }));

    const result = await runDigest();

    expect(result).toMatchObject({ posted: false, reason: 'post-failed' });
  });

  it('does not write the day marker unless asked (the manual trigger)', async () => {
    const now = Date.now();
    vi.mocked(serverLogger.entriesSince).mockResolvedValue([entry()]);

    await runDigest({ now });

    expect(existsSync(markerPath(new Date(now)))).toBe(false);
  });

  it('writes the day marker for the scheduled run, including a quiet day', async () => {
    const now = Date.now();
    vi.mocked(serverLogger.entriesSince).mockResolvedValue([]);

    const result = await runDigest({ now, writeMarker: true });

    expect(result.reason).toBe('quiet');
    expect(await markerExists(new Date(now))).toBe(true);
    rmSync(markerPath(new Date(now)));
  });

  it('writes the day marker even when the post failed, so it cannot retry every minute', async () => {
    const now = Date.now();
    vi.mocked(serverLogger.entriesSince).mockResolvedValue([entry()]);
    fetchMock.mockRejectedValue(new Error('network down'));

    const result = await runDigest({ now, writeMarker: true });

    expect(result.posted).toBe(false);
    expect(await markerExists(new Date(now))).toBe(true);
    rmSync(markerPath(new Date(now)));
  });

  it('honours an explicit window', async () => {
    const now = Date.now();
    vi.mocked(serverLogger.entriesSince).mockResolvedValue([]);

    await runDigest({ now, since: now - 3 * 60 * 60 * 1000 });

    expect(serverLogger.entriesSince).toHaveBeenCalledWith(now - 3 * 60 * 60 * 1000);
  });
});
