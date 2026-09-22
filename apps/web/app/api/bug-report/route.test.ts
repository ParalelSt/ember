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
// vi.fn() (not a plain arrow) so tests below can assert on call args/keys:
// vi.mocked() needs a real mock function, not just something shaped like one.
vi.mock('@/lib/rateLimit', () => ({ rateLimitResponse: vi.fn(() => null) }));
vi.mock('@/lib/logger/server', () => ({
  serverLogger: { recentSince: vi.fn(async () => []), entriesSince: vi.fn(async () => []), error: vi.fn() },
}));
// triageBugReport is the only thing stubbed: it needs a live API key and a
// network call, neither of which belongs in this suite. formatSeenBefore is
// kept real (imported through) so the "Seen before" field tests below
// exercise the actual fingerprint/history logic, not a stand-in for it.
vi.mock('@/lib/ai/triage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/triage')>();
  return { ...actual, triageBugReport: vi.fn(async () => null) };
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
const { rateLimitResponse } = await import('@/lib/rateLimit');
const { triageBugReport } = await import('@/lib/ai/triage');

/** The Discord embed the route built (parsed out of the multipart payload). */
function postedEmbed(
  fetchMock: ReturnType<typeof vi.fn>,
): { title: string; description: string; footer?: { text: string }; fields: { name: string; value: string }[] } {
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
  vi.mocked(rateLimitResponse).mockReturnValue(null);
  vi.mocked(triageBugReport).mockResolvedValue(null);
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

  it('selects the same lines as the triage prompt for the same input (T2 review: they used to diverge)', async () => {
    // Small enough that neither the Evidence field's maxLines:25 nor the
    // prompt's much larger cap needs to cut anything: the only thing left
    // to differ would be the selection logic itself, so an exact match here
    // proves route.ts and lib/ai/triage.ts share it (both call
    // selectTimeline/buildTimeline from lib/reports/timeline.ts). Date.now
    // is pinned so the route's reportedAt and this test's own buildDigest
    // call render identical relative times.
    const NOW = 1_800_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(NOW);
    try {
      const current = [
        { ts: NOW - 5000, kind: 'breadcrumb', level: 'info', category: 'playback', message: 'play', sessionId: 's1' },
        { ts: NOW - 3000, kind: 'error', level: 'error', category: 'api', message: 'stream failed', sessionId: 's1' },
      ] as ClientSnapshot['current'];
      const server = [serverError({ ts: NOW - 4000 })];
      vi.mocked(serverLogger.recentSince).mockResolvedValue(server);

      const res = await POST(request({ client: snapshot({ current }) }), undefined as never);
      expect(res.status).toBe(200);
      const embed = postedEmbed(fetchMock);
      const evidenceText = embed.fields
        .filter((f) => f.name === 'Evidence' || f.name.startsWith('Evidence ('))
        .map((f) => f.value.replace(/^```\n/, '').replace(/```$/, ''))
        .join('\n');

      const { buildDigest } = await import('@/lib/ai/triage');
      const digest = buildDigest({
        note: '',
        client: { current, previous: [], sessionId: 's1' },
        server,
        userAgent: 'test',
        context: undefined,
      });
      const timelineFromDigest = digest.split('## Timeline\n')[1].split('\n\n## Seen before')[0];

      expect(evidenceText.trim()).toBe(timelineFromDigest.trim());
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('keeps the whole embed under Discord\'s 6000-char cap even with a full triage response and a long Evidence timeline (final-review fix)', async () => {
    // Every long field this route can produce at once: 40 distinct, longish
    // server errors (Evidence would need several full 1024-char fields on
    // its own) plus a maxed-out triage response (Reproduce + 4 Check-first
    // lines). Before the fix, Evidence was capped only per-field, so this
    // combination could push the embed's total past 6000 and get the whole
    // report rejected by Discord.
    const longErrors = Array.from({ length: 40 }, (_, i) =>
      serverError({
        ts: Date.now() - (40 - i) * 1000,
        reqId: `r${i}`,
        message: `GET /api/youtube/stream/video-${i}-${'x'.repeat(80)} -> 502 upstream timeout`,
      }),
    );
    vi.mocked(serverLogger.recentSince).mockResolvedValue(longErrors);
    vi.mocked(triageBugReport).mockResolvedValueOnce({
      summary: 'S'.repeat(300),
      likelyCause: 'C'.repeat(800),
      area: 'streaming',
      severity: 'high',
      confidence: 'high',
      nextSteps: Array.from({ length: 4 }, (_, i) => `Step ${i} `.repeat(20).slice(0, 300)),
      reproduction: 'R'.repeat(500),
    });

    const res = await POST(request({ client: snapshot() }), undefined as never);
    expect(res.status).toBe(200);

    const embed = postedEmbed(fetchMock);
    const total =
      embed.title.length +
      embed.description.length +
      (embed.footer?.text.length ?? 0) +
      embed.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
    expect(total).toBeLessThanOrEqual(6000);

    const evidenceFields = embed.fields.filter((f) => f.name === 'Evidence' || f.name.startsWith('Evidence ('));
    expect(evidenceFields.length).toBeGreaterThan(0);
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

describe('POST /api/bug-report: automatic reports', () => {
  it('titles the embed "Automatic report from <email>" and marks the footer', async () => {
    const res = await POST(request({ client: snapshot(), automatic: true }), undefined as never);
    expect(res.status).toBe(200);
    const parsed = JSON.parse(postedForm(fetchMock).get('payload_json') as string);
    expect(parsed.embeds[0].title).toBe('Automatic report from dev@ember.test');
    expect(parsed.embeds[0].footer.text).toContain('automatic');
  });

  it('does not mark the footer or title for a manual report', async () => {
    const res = await POST(request({ client: snapshot() }), undefined as never);
    expect(res.status).toBe(200);
    const parsed = JSON.parse(postedForm(fetchMock).get('payload_json') as string);
    expect(parsed.embeds[0].title).toBe('Bug report from dev@ember.test');
    expect(parsed.embeds[0].footer).toBeUndefined();
  });

  it('rate-limits automatic reports under a separate key from manual reports', async () => {
    await POST(request({ client: snapshot(), automatic: true }), undefined as never);
    await POST(request({ client: snapshot() }), undefined as never);

    const keys = vi.mocked(rateLimitResponse).mock.calls.map((c) => c[0]);
    expect(keys).toContain('bug-report:auto:u1');
    expect(keys).toContain('bug-report:u1');
  });

  it('passes automatic through to triageBugReport so it can pick the cheaper model', async () => {
    await POST(request({ client: snapshot(), automatic: true }), undefined as never);
    expect(triageBugReport).toHaveBeenCalledWith(expect.objectContaining({ automatic: true }));

    await POST(request({ client: snapshot() }), undefined as never);
    expect(triageBugReport).toHaveBeenCalledWith(expect.objectContaining({ automatic: false }));
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

describe('POST /api/bug-report: note scrubbing', () => {
  it('redacts a token pasted into the note', async () => {
    await POST(request({ note: 'it broke after Authorization: Bearer sk-ant-abcdefgh12345678', client: { current: [], previous: [], sessionId: 's' } }), {} as never);
    const raw = postedForm(fetchMock).get('payload_json') as string;
    expect(raw).not.toContain('sk-ant-abcdefgh12345678');
    expect(raw).toContain('[scrubbed]');
  });
});


describe('POST /api/bug-report: attachments', () => {
  const MB = 1024 * 1024;
  const file = (name: string, type: string, size?: number) => {
    const f = new File([`bytes of ${name}`], name, { type });
    if (size !== undefined) Object.defineProperty(f, 'size', { value: size });
    return f;
  };
  function multipart(body: unknown, files: File[]): NextRequest {
    const form = new FormData();
    form.append('payload', JSON.stringify(body));
    for (const f of files) form.append('attachments', f, f.name);
    return {
      json: async () => {
        throw new Error('multipart body read as JSON');
      },
      formData: async () => form,
      headers: new Headers({ 'content-type': 'multipart/form-data; boundary=----x', 'user-agent': 'Ember web' }),
    } as unknown as NextRequest;
  }

  it('puts the files after report.json, with their names', async () => {
    const res = await POST(
      multipart({ note: 'went silent', client: snapshot() }, [file('shot.png', 'image/png'), file('my clip.webm', 'video/webm')]),
      undefined as never,
    );
    expect(res.status).toBe(200);
    const form = postedForm(fetchMock);
    expect((form.get('files[0]') as File).name).toBe('report.json');
    expect((form.get('files[1]') as File).name).toBe('shot.png');
    expect(await (form.get('files[1]') as File).text()).toBe('bytes of shot.png');
    expect((form.get('files[2]') as File).name).toBe('my_clip.webm');
    expect(form.get('files[3]')).toBeNull();
    expect(postedEmbed(fetchMock).description).toBe('went silent');
  });

  it('puts the files after the desktop log when there is one', async () => {
    await POST(
      multipart({ client: snapshot({ desktopLog: '[1] INFO starting' }) }, [file('shot.png', 'image/png')]),
      undefined as never,
    );
    const form = postedForm(fetchMock);
    const names = [0, 1, 2].map((i) => (form.get(`files[${i}]`) as File).name);
    expect(names).toEqual(['report.json', 'desktop.log', 'shot.png']);
    expect(form.get('files[3]')).toBeNull();
  });

  it('keeps the attachments out of report.json', async () => {
    await POST(multipart({ client: snapshot() }, [file('shot.png', 'image/png')]), undefined as never);
    const report = await (postedForm(fetchMock).get('files[0]') as File).text();
    expect(report).not.toContain('bytes of shot.png');
  });

  it('400s with the dialog sentence when the files are too big', async () => {
    const res = await POST(
      multipart({ client: snapshot() }, [file('a.mp4', 'video/mp4', 6 * MB), file('b.mp4', 'video/mp4', 5 * MB)]),
      undefined as never,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Files are 11 MB. Discord takes 10 MB per message: trim the clip or send fewer files.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('400s on a file that is not an image or a video, and on more than 4 files', async () => {
    const bad = await POST(multipart({ client: snapshot() }, [file('x.zip', 'application/zip')]), undefined as never);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'x.zip is not an image or a video.' });
    const five = ['1', '2', '3', '4', '5'].map((n) => file(`${n}.png`, 'image/png'));
    const many = await POST(multipart({ client: snapshot() }, five), undefined as never);
    expect(many.status).toBe(400);
    expect(await many.json()).toEqual({ error: 'Up to 4 files per message.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('400s on a multipart body without a valid report', async () => {
    const res = await POST(multipart({ note: 'no client' }, []), undefined as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid report body' });
  });

  it('a JSON report (the crash reporter) still goes through with no extra files', async () => {
    const res = await POST(request({ note: 'TypeError: x', client: snapshot(), automatic: true }), undefined as never);
    expect(res.status).toBe(200);
    const form = postedForm(fetchMock);
    expect((form.get('files[0]') as File).name).toBe('report.json');
    expect(form.get('files[1]')).toBeNull();
  });
});

describe('POST /api/bug-report: attachments too big for Discord', () => {
  function multipart(body: unknown, files: File[]): NextRequest {
    const form = new FormData();
    form.append('payload', JSON.stringify(body));
    for (const f of files) form.append('attachments', f, f.name);
    return {
      formData: async () => form,
      headers: new Headers({ 'content-type': 'multipart/form-data; boundary=----x' }),
    } as unknown as NextRequest;
  }
  const clip = new File(['x'.repeat(3 * 1024)], 'clip.webm', { type: 'video/webm' });

  it('sends the report again without the files, notes them, and flags it', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 413, text: async () => 'request entity too large' })
      .mockResolvedValueOnce({ ok: true, text: async () => '' });
    const res = await POST(
      multipart({ note: 'went silent', client: snapshot({ desktopLog: '[1] INFO starting' }) }, [clip]),
      undefined as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, triage: null, attachmentsDropped: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = (fetchMock.mock.calls[0] as [string, { body: FormData }])[1].body;
    expect((first.get('files[2]') as File).name).toBe('clip.webm');
    const second = postedForm(fetchMock);
    expect((second.get('files[0]') as File).name).toBe('report.json');
    expect((second.get('files[1]') as File).name).toBe('desktop.log');
    expect(second.get('files[2]')).toBeNull();
    const fields = postedEmbed(fetchMock).fields;
    expect(fields.at(-1)).toEqual({
      name: 'Attachments',
      value: '1 file, 3 KB, too big for Discord, not included',
      inline: false,
    });
    // The first message had no such field.
    const firstEmbed = JSON.parse(first.get('payload_json') as string).embeds[0];
    expect(firstEmbed.fields.some((f: { name: string }) => f.name === 'Attachments')).toBe(false);
  });

  it('does not retry other failures, or a report without files', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => '{"code": 50035}' });
    const other = await POST(multipart({ client: snapshot() }, [clip]), undefined as never);
    expect(other.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();
    fetchMock.mockResolvedValue({ ok: false, status: 413, text: async () => '' });
    const plain = await POST(request({ client: snapshot() }), undefined as never);
    expect(plain.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('502s when the resend fails too', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 413, text: async () => 'too big' });
    const res = await POST(multipart({ client: snapshot() }, [clip]), undefined as never);
    expect(res.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('POST /api/bug-report: Discord unreachable', () => {
  it('answers with a sentence a person can read, not "fetch failed"', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const res = await POST(request({ client: snapshot() }), undefined as never);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Couldn't reach Discord, please try again");
    expect(body.error).not.toContain('fetch failed');
  });
});
