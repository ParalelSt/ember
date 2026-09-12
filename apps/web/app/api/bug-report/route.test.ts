// @vitest-environment node
// Node, not happy-dom: this is server code, and happy-dom's FormData drops the
// filename passed with a Blob, which is the thing being asserted here.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The suite reports as an @ember.test account; an explicit webhook keeps the
// route posting (the sandbox guard only bites when the default one is in use).
vi.hoisted(() => {
  process.env.DISCORD_BUG_REPORT_WEBHOOK_URL = 'http://127.0.0.1:4312/hook';
});
import type { NextRequest } from 'next/server';
import type { ClientSnapshot, ServerLogEntry } from '@/lib/logger/types';

// Everything the route leans on is stubbed: this is about what reaches the
// Discord webhook, not about auth, rate limiting or triage.
vi.mock('@/lib/auth', () => ({
  requireUser: async () => ({ user: { id: 'u1', email: 'dev@ember.test' } }),
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => new Response('no', { status: 401 }),
}));
vi.mock('@/lib/rateLimit', () => ({ rateLimitResponse: () => null }));
vi.mock('@/lib/logger/server', () => ({
  serverLogger: { recentSince: vi.fn(async () => []), entriesSince: vi.fn(async () => []) },
}));
// triageBugReport is the only thing stubbed: it needs a live API key and a
// network call, neither of which belongs in this suite. formatSeenBefore is
// kept real (imported through) so the "Seen before" field tests below
// exercise the actual fingerprint/history logic, not a stand-in for it.
vi.mock('@/lib/ai/triage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/triage')>();
  return { ...actual, triageBugReport: async () => null };
});
vi.mock('@/lib/upsertTrack', () => ({
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
// withRequestLog wraps the handler in T2's request logging; the handler itself
// is what this test drives.
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { POST } = await import('./route');
const { serverLogger } = await import('@/lib/logger/server');

/** The Discord embed the route built (parsed out of the multipart payload). */
function postedEmbed(fetchMock: ReturnType<typeof vi.fn>): { fields: { name: string; value: string }[] } {
  const form = postedForm(fetchMock);
  const payload = JSON.parse(form.get('payload_json') as string);
  return payload.embeds[0];
}

function serverError(over: Partial<ServerLogEntry> = {}): ServerLogEntry {
  return {
    ts: Date.now(),
    kind: 'error',
    level: 'error',
    category: 'api',
    message: 'GET /api/youtube/stream/abc123 -> 502',
    sessionId: 's1',
    side: 'server',
    reqId: 'r1',
    route: '/api/youtube/stream',
    ...over,
  };
}

function snapshot(over: Partial<ClientSnapshot> = {}): ClientSnapshot {
  return {
    current: [],
    previous: [],
    sessionId: 's1',
    context: { shell: 'tauri' } as ClientSnapshot['context'],
    ...over,
  };
}

function request(body: unknown): NextRequest {
  return {
    json: async () => body,
    headers: new Headers({ 'user-agent': 'Ember desktop' }),
  } as unknown as NextRequest;
}

/** The multipart form the route posted to Discord. */
function postedForm(fetchMock: ReturnType<typeof vi.fn>): FormData {
  const [, init] = fetchMock.mock.calls.at(-1) as [string, { body: FormData }];
  return init.body;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(serverLogger.recentSince).mockResolvedValue([]);
  vi.mocked(serverLogger.entriesSince).mockResolvedValue([]);
});

describe('POST /api/bug-report: desktop log', () => {
  it('attaches the desktop log as its own file and keeps it out of report.json', async () => {
    const desktopLog = '[1] INFO ember-desktop starting\n[2] WARN media controls unavailable';
    const res = await POST(request({ client: snapshot({ desktopLog }) }), undefined as never);

    expect(res.status).toBe(200);
    const form = postedForm(fetchMock);
    const attached = form.get('files[1]') as File;
    expect(attached.name).toBe('desktop.log');
    expect(await attached.text()).toBe(desktopLog);
    // report.json carries the snapshot minus the tail, which would otherwise
    // be in the payload twice.
    expect(await (form.get('files[0]') as File).text()).not.toContain('media controls unavailable');
  });

  it('sends only report.json when there is no desktop log', async () => {
    await POST(request({ client: snapshot() }), undefined as never);
    expect(postedForm(fetchMock).get('files[1]')).toBeNull();
  });

  it('ignores a desktopLog that is not a string', async () => {
    await POST(request({ client: snapshot({ desktopLog: { not: 'a string' } as unknown as string }) }), undefined as never);
    expect(postedForm(fetchMock).get('files[1]')).toBeNull();
  });
});

describe('POST /api/bug-report: context validation', () => {
  it('drops a non-object context instead of rejecting the report', async () => {
    const res = await POST(
      request({ client: snapshot({ context: 'not-an-object' as unknown as ClientSnapshot['context'] }) }),
      undefined as never,
    );
    expect(res.status).toBe(200);
    const reportJson = JSON.parse(await (postedForm(fetchMock).get('files[0]') as File).text());
    expect(reportJson.client.context).toBeUndefined();
  });

  it('drops an array context (still typeof "object", not a plain object)', async () => {
    const res = await POST(
      request({ client: snapshot({ context: ['weird'] as unknown as ClientSnapshot['context'] }) }),
      undefined as never,
    );
    expect(res.status).toBe(200);
    const reportJson = JSON.parse(await (postedForm(fetchMock).get('files[0]') as File).text());
    expect(reportJson.client.context).toBeUndefined();
  });

  it('keeps a well-formed context', async () => {
    const res = await POST(
      request({ client: snapshot({ context: { shell: 'tauri', route: '/library' } as ClientSnapshot['context'] }) }),
      undefined as never,
    );
    expect(res.status).toBe(200);
    const reportJson = JSON.parse(await (postedForm(fetchMock).get('files[0]') as File).text());
    expect(reportJson.client.context).toEqual({ shell: 'tauri', route: '/library' });
  });
});

describe('POST /api/bug-report: server log scrubbing', () => {
  it('redacts a token in a server entry\'s data before it reaches the webhook payload', async () => {
    const entry: ServerLogEntry = {
      ts: Date.now(),
      kind: 'error',
      level: 'error',
      category: 'api',
      message: 'upstream auth failed',
      data: { header: 'Authorization: Bearer sk-ant-abcdefgh12345678' },
      sessionId: 's1',
      side: 'server',
      reqId: 'r1',
      route: 'upstream',
      userId: 'user123',
    };
    vi.mocked(serverLogger.recentSince).mockResolvedValue([entry]);

    const res = await POST(request({ client: snapshot() }), undefined as never);
    expect(res.status).toBe(200);
    const reportText = await (postedForm(fetchMock).get('files[0]') as File).text();
    expect(reportText).not.toContain('sk-ant-abcdefgh12345678');
    expect(reportText).toContain('[scrubbed]');
    // userId is the host's own PocketBase id, not a secret: it survives.
    expect(reportText).toContain('user123');
  });
});

describe('POST /api/bug-report: sandbox guard', () => {
  it('does not post a test account report to the default webhook', async () => {
    const saved = process.env.DISCORD_BUG_REPORT_WEBHOOK_URL;
    delete process.env.DISCORD_BUG_REPORT_WEBHOOK_URL;
    vi.resetModules();
    try {
      const { POST } = await import('./route');
      const res = await POST(request({ note: 'x', client: { current: [], previous: [], sessionId: 's' } }), {} as never);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, skipped: 'test account' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      process.env.DISCORD_BUG_REPORT_WEBHOOK_URL = saved;
      vi.resetModules();
    }
  });
});

describe('POST /api/bug-report: Evidence timeline', () => {
  it('renders a readable timeline (not the raw JSONL) in an "Evidence" field', async () => {
    vi.mocked(serverLogger.recentSince).mockResolvedValue([serverError()]);
    const client = snapshot({
      current: [
        { ts: Date.now() - 1000, kind: 'error', level: 'error', category: 'api', message: 'stream failed', sessionId: 's1' },
      ],
    });
    const res = await POST(request({ client }), undefined as never);
    expect(res.status).toBe(200);

    const embed = postedEmbed(fetchMock);
    const evidence = embed.fields.find((f) => f.name === 'Evidence');
    expect(evidence).toBeDefined();
    // formatTimeline's own shape: an "Errors" block, entries wrapped in a
    // code fence, no raw '"kind":"error"'-style JSON.
    expect(evidence!.value).toContain('```');
    expect(evidence!.value).toContain('Errors');
    expect(evidence!.value).toContain('stream failed');
    expect(evidence!.value).not.toContain('"kind"');
  });

  it('splits Evidence across fields when the rendered timeline exceeds Discord\'s 1024-char field cap', async () => {
    // 40 distinct, longish server errors comfortably push the rendered
    // timeline (formatTimeline caps at 25 lines, but each line here is long)
    // past 1024 chars once fenced.
    const longErrors = Array.from({ length: 25 }, (_, i) =>
      serverError({
        ts: Date.now() - (25 - i) * 1000,
        reqId: `r${i}`,
        message: `GET /api/youtube/stream/video-${i} -> 502 upstream timeout after 30000ms, retried 3 times, giving up`,
      }),
    );
    vi.mocked(serverLogger.recentSince).mockResolvedValue(longErrors);

    const res = await POST(request({ client: snapshot() }), undefined as never);
    expect(res.status).toBe(200);

    const embed = postedEmbed(fetchMock);
    const evidenceFields = embed.fields.filter((f) => f.name === 'Evidence' || f.name.startsWith('Evidence ('));
    expect(evidenceFields.length).toBeGreaterThan(1);
    for (const f of evidenceFields) expect(f.value.length).toBeLessThanOrEqual(1024);
    // Nothing was silently dropped: every distinct error still appears
    // somewhere across the split fields, not truncated with "...".
    const combined = evidenceFields.map((f) => f.value).join('\n');
    expect(combined).toContain('video-0');
    expect(combined).toContain('video-24');
    expect(combined).not.toContain('...');
  });
});

describe('POST /api/bug-report: Seen before', () => {
  it('reports "first time" for an error fingerprint with no history', async () => {
    vi.mocked(serverLogger.recentSince).mockResolvedValue([serverError()]);
    vi.mocked(serverLogger.entriesSince).mockResolvedValue([]);

    const res = await POST(request({ client: snapshot() }), undefined as never);
    expect(res.status).toBe(200);
    const embed = postedEmbed(fetchMock);
    const seenBefore = embed.fields.find((f) => f.name === 'Seen before');
    expect(seenBefore?.value).toContain('first time');
  });

  it('reports a repeat count and first-seen date when the fingerprint has occurred before', async () => {
    const now = Date.now();
    const thisOccurrence = serverError({ ts: now });
    vi.mocked(serverLogger.recentSince).mockResolvedValue([thisOccurrence]);
    // Same route/category/message shape (fingerprint ignores the numeric
    // id), spread across the past week, including this occurrence.
    vi.mocked(serverLogger.entriesSince).mockResolvedValue([
      serverError({ ts: now - 6 * 24 * 60 * 60 * 1000, message: 'GET /api/youtube/stream/xyz789 -> 502' }),
      serverError({ ts: now - 3 * 24 * 60 * 60 * 1000, message: 'GET /api/youtube/stream/def456 -> 502' }),
      thisOccurrence,
    ]);

    const res = await POST(request({ client: snapshot() }), undefined as never);
    expect(res.status).toBe(200);
    const embed = postedEmbed(fetchMock);
    const seenBefore = embed.fields.find((f) => f.name === 'Seen before');
    expect(seenBefore?.value).toContain('seen 3 times this week');
    expect(seenBefore?.value).not.toContain('first time');
  });

  it('omits server errors with no history from the report and still succeeds', async () => {
    vi.mocked(serverLogger.recentSince).mockResolvedValue([]);
    const res = await POST(request({ client: snapshot() }), undefined as never);
    expect(res.status).toBe(200);
    const embed = postedEmbed(fetchMock);
    const seenBefore = embed.fields.find((f) => f.name === 'Seen before');
    expect(seenBefore?.value).toBe('(no server errors in this report)');
  });
});

describe('POST /api/bug-report: field restructure', () => {
  it('leads with "What broke" and keeps "Where", dropping the old severity-in-title field name', async () => {
    const res = await POST(request({ note: 'songs skip', client: snapshot() }), undefined as never);
    expect(res.status).toBe(200);
    const embed = postedEmbed(fetchMock);
    expect(embed.fields[0].name).toBe('What broke');
    expect(embed.fields[0].value).toBe('songs skip');
    expect(embed.fields.some((f) => f.name === 'Where')).toBe(true);
    // Title is unchanged (T3's "(automatic)" suffix is out of scope here).
  });
});

