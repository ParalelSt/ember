// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env.DISCORD_FEATURE_WEBHOOK_URL = 'http://127.0.0.1:4321/feature';
  process.env.DISCORD_FIX_WEBHOOK_URL = 'http://127.0.0.1:4321/fix';
});
import type { NextRequest } from 'next/server';

const requireUserMock = vi.fn(async () => ({ user: { id: 'u1', email: 'dev@ember.test' } }));
vi.mock('@/lib/auth', () => ({
  requireUser: () => requireUserMock(),
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
const rateLimitMock = vi.fn(() => null as Response | null);
const recordRateLimitHitMock = vi.fn();
vi.mock('@/lib/rateLimit', () => ({
  rateLimitResponse: () => rateLimitMock(),
  recordRateLimitHit: () => recordRateLimitHitMock(),
}));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn() } }));
vi.mock('@/lib/upsertTrack', () => ({
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { POST } = await import('./route');
const { resolveWebhook } = await import('@/lib/requestWebhooks');

function request(body: unknown): NextRequest {
  return {
    json: async () => body,
    headers: new Headers(),
  } as unknown as NextRequest;
}

function validBody(over: Record<string, unknown> = {}) {
  return {
    kind: 'feature',
    name: 'Sleep timer',
    main: 'Stop playback after 30 minutes so I can fall asleep to music.',
    extra: '',
    context: { appVersion: '1.2.3', shell: 'web', route: '/library', platform: 'MacIntel' },
    ...over,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
  vi.stubGlobal('fetch', fetchMock);
  requireUserMock.mockResolvedValue({ user: { id: 'u1', email: 'dev@ember.test' } });
  rateLimitMock.mockReturnValue(null);
  recordRateLimitHitMock.mockClear();
  process.env.DISCORD_FEATURE_WEBHOOK_URL = 'http://127.0.0.1:4321/feature';
  process.env.DISCORD_FIX_WEBHOOK_URL = 'http://127.0.0.1:4321/fix';
});

interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  fields: { name: string; value: string }[];
  footer?: { text: string };
}

function postedPayload(): { url: string; body: { embeds: DiscordEmbed[] } } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, { body: string }];
  return { url, body: JSON.parse(init.body) as { embeds: DiscordEmbed[] } };
}

describe('POST /api/requests: routing per kind', () => {
  it('feature posts to the feature webhook with the right embed', async () => {
    const res = await POST(request(validBody()), undefined as never);
    expect(res.status).toBe(200);
    const { url, body } = postedPayload();
    expect(url).toBe('http://127.0.0.1:4321/feature');
    const embed = body.embeds[0];
    expect(embed.title).toBe('New feature: Sleep timer');
    expect(embed.description).toBe('Stop playback after 30 minutes so I can fall asleep to music.');
    expect(embed.footer).toEqual({ text: 'dev@ember.test · 1.2.3 · web · /library' });
    expect(embed.color).toBe(0xff5a3a);
  });

  it('fix posts to the fix webhook with the right embed', async () => {
    const res = await POST(
      request(validBody({ kind: 'fix', name: 'Queue jumps to the top', main: 'It should stay in place.' })),
      undefined as never,
    );
    expect(res.status).toBe(200);
    const { url, body } = postedPayload();
    expect(url).toBe('http://127.0.0.1:4321/fix');
    const embed = body.embeds[0];
    expect(embed.title).toBe('Fix: Queue jumps to the top');
    expect(embed.description).toBe('It should stay in place.');
    expect(embed.color).toBe(0x3a82f7);
  });

  it('includes an "Anything else" field only when extra is non-empty', async () => {
    await POST(request(validBody({ extra: 'Happens on Chrome only' })), undefined as never);
    const { body } = postedPayload();
    const embed = body.embeds[0];
    expect(embed.fields).toEqual([{ name: 'Anything else', value: 'Happens on Chrome only' }]);
  });

  it('omits the field entirely when extra is empty', async () => {
    await POST(request(validBody({ extra: '' })), undefined as never);
    const { body } = postedPayload();
    const embed = body.embeds[0];
    expect(embed.fields).toEqual([]);
  });
});

describe('resolveWebhook', () => {
  const defaults = { feature: 'https://example.test/feature', fix: 'https://example.test/fix' };
  it('prefers the env webhook over the built-in one', () => {
    expect(resolveWebhook('fix', 'a@b.c', { DISCORD_FIX_WEBHOOK_URL: 'https://env/fix' }, defaults)).toEqual({ url: 'https://env/fix', skip: false });
  });
  it('falls back to the built-in channel when env is unset', () => {
    expect(resolveWebhook('feature', 'friend@example.com', {}, defaults)).toEqual({ url: 'https://example.test/feature', skip: false });
  });
  it('skips test accounts when only the built-in channel would receive it', () => {
    expect(resolveWebhook('feature', 'dev@ember.test', {}, defaults)).toEqual({ url: 'https://example.test/feature', skip: true });
  });
  it('lets test accounts post to an explicit env webhook (the sandbox sinks)', () => {
    expect(resolveWebhook('fix', 'dev@ember.test', { DISCORD_FIX_WEBHOOK_URL: 'http://127.0.0.1:4321/fix' }, defaults).skip).toBe(false);
  });
  it('returns no url when neither env nor a built-in channel is set', () => {
    expect(resolveWebhook('fix', 'a@b.c', {}, { feature: '', fix: '' })).toEqual({ url: '', skip: false });
  });
});

describe('POST /api/requests: missing webhook', () => {
  it('503s for the kind with no webhook configured, and never calls fetch', async () => {
    delete process.env.DISCORD_FEATURE_WEBHOOK_URL;
    const res = await POST(request(validBody({ kind: 'feature' })), undefined as never);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Requests are not set up on this server' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/requests: validation', () => {
  it('rejects an invalid kind', async () => {
    const res = await POST(request(validBody({ kind: 'other' })), undefined as never);
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    // [bughunt W12] a request that never reaches Discord must not burn the
    // hourly quota.
    expect(recordRateLimitHitMock).not.toHaveBeenCalled();
  });

  it('rejects an empty name', async () => {
    const res = await POST(request(validBody({ name: '  ' })), undefined as never);
    expect(res.status).toBe(400);
  });

  it('rejects a name over 80 characters', async () => {
    const res = await POST(request(validBody({ name: 'x'.repeat(81) })), undefined as never);
    expect(res.status).toBe(400);
  });

  it('rejects an empty main field', async () => {
    const res = await POST(request(validBody({ main: '' })), undefined as never);
    expect(res.status).toBe(400);
  });

  it('rejects a main field over 2000 characters', async () => {
    const res = await POST(request(validBody({ main: 'x'.repeat(2001) })), undefined as never);
    expect(res.status).toBe(400);
  });

  it('rejects an extra field over 2000 characters', async () => {
    const res = await POST(request(validBody({ extra: 'x'.repeat(2001) })), undefined as never);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/requests: scrubbing', () => {
  it('never lets a bearer token in main reach the Discord payload', async () => {
    await POST(
      request(validBody({ main: 'Auth fails: bearer sk-ant-abcdefgh12345678 in the header' })),
      undefined as never,
    );
    const { body } = postedPayload();
    const embed = body.embeds[0];
    expect(JSON.stringify(embed)).not.toContain('sk-ant-abcdefgh12345678');
    expect(embed.description).toContain('[scrubbed]');
  });
});

describe('POST /api/requests: rate limiting', () => {
  it('returns the limiter response when rate limited', async () => {
    const limitedResponse = Response.json({ error: 'Slow down' }, { status: 429 });
    rateLimitMock.mockReturnValue(limitedResponse);
    const res = await POST(request(validBody()), undefined as never);
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('[bughunt W12] charges the quota once Discord accepts the message, and not before', async () => {
    const res = await POST(request(validBody()), undefined as never);
    expect(res.status).toBe(200);
    expect(recordRateLimitHitMock).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/requests: Discord failure', () => {
  it('502s when Discord rejects the post', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'server error' });
    const res = await POST(request(validBody()), undefined as never);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Couldn't send the request, please try again" });
  });

  it('[bughunt W12] does not charge the quota when Discord rejects the post', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'server error' });
    await POST(request(validBody()), undefined as never);
    expect(recordRateLimitHitMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/requests: auth', () => {
  it('401s when signed out', async () => {
    const { UnauthorizedError } = await import('@/lib/auth');
    requireUserMock.mockRejectedValue(new UnauthorizedError());
    const res = await POST(request(validBody()), undefined as never);
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/requests: attachments', () => {
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
      headers: new Headers({ 'content-type': 'multipart/form-data; boundary=----x' }),
    } as unknown as NextRequest;
  }

  it('forwards the files as files[n] on the same message, with their names', async () => {
    const res = await POST(
      multipart(validBody({ kind: 'fix' }), [file('Screen Shot 1.png', 'image/png'), file('clip.mp4', 'video/mp4')]),
      undefined as never,
    );
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, { body: FormData; headers?: unknown }];
    expect(url).toBe('http://127.0.0.1:4321/fix');
    expect(init.headers).toBeUndefined();
    const form = init.body;
    const payload = JSON.parse(form.get('payload_json') as string);
    expect(payload.embeds[0].title).toBe('Fix: Sleep timer');
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    const first = form.get('files[0]') as File;
    const second = form.get('files[1]') as File;
    expect(first.name).toBe('Screen_Shot_1.png');
    expect(await first.text()).toBe('bytes of Screen Shot 1.png');
    expect(second.name).toBe('clip.mp4');
    expect(form.get('files[2]')).toBeNull();
  });

  it('still scrubs the text fields of a multipart request', async () => {
    await POST(
      multipart(validBody({ main: 'bearer sk-ant-abcdefgh12345678 fails' }), [file('a.png', 'image/png')]),
      undefined as never,
    );
    const [, init] = fetchMock.mock.calls.at(-1) as [string, { body: FormData }];
    expect(init.body.get('payload_json')).not.toContain('sk-ant-abcdefgh12345678');
  });

  it('400s with the dialog sentence when the files are too big', async () => {
    const res = await POST(multipart(validBody(), [file('long.mp4', 'video/mp4', 11 * MB)]), undefined as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Files are 11 MB. Discord takes 10 MB per message: trim the clip or send fewer files.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('400s on a file that is not an image or a video', async () => {
    const res = await POST(multipart(validBody(), [file('notes.pdf', 'application/pdf')]), undefined as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'notes.pdf is not an image or a video.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('400s on more than 4 files', async () => {
    const five = ['1', '2', '3', '4', '5'].map((n) => file(`${n}.png`, 'image/png'));
    const res = await POST(multipart(validBody(), five), undefined as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Up to 4 files per message.' });
  });

  it('400s on a multipart body without a readable payload', async () => {
    const form = new FormData();
    form.append('payload', '{not json');
    const req = {
      formData: async () => form,
      headers: new Headers({ 'content-type': 'multipart/form-data; boundary=----x' }),
    } as unknown as NextRequest;
    const res = await POST(req, undefined as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid request body' });
  });

  it('a JSON request keeps going out as JSON', async () => {
    await POST(request(validBody()), undefined as never);
    const [, init] = fetchMock.mock.calls.at(-1) as [string, { body: unknown; headers: unknown }];
    expect(typeof init.body).toBe('string');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
  });
});

describe('POST /api/requests: attachments too big for Discord', () => {
  function multipart(files: File[]): NextRequest {
    const form = new FormData();
    form.append('payload', JSON.stringify(validBody({ extra: 'Only on Chrome' })));
    for (const f of files) form.append('attachments', f, f.name);
    return {
      formData: async () => form,
      headers: new Headers({ 'content-type': 'multipart/form-data; boundary=----x' }),
    } as unknown as NextRequest;
  }
  const png = (name: string) => new File(['x'.repeat(2048)], name, { type: 'image/png' });

  it('sends once more without the files, notes them in the embed, and flags it', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 413, text: async () => 'request entity too large' })
      .mockResolvedValueOnce({ ok: true, text: async () => '' });
    const res = await POST(multipart([png('a.png'), png('b.png')]), undefined as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, attachmentsDropped: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = (fetchMock.mock.calls[0] as [string, { body: FormData }])[1].body;
    const [url, init] = fetchMock.mock.calls[1] as [string, { body: FormData }];
    expect(first.get('files[0]')).not.toBeNull();
    expect(url).toBe('http://127.0.0.1:4321/feature');
    expect(init.body.get('files[0]')).toBeNull();
    const embed = JSON.parse(init.body.get('payload_json') as string).embeds[0];
    expect(embed.title).toBe('New feature: Sleep timer');
    expect(embed.fields).toEqual([
      { name: 'Anything else', value: 'Only on Chrome' },
      { name: 'Attachments', value: '2 files, 4 KB, too big for Discord, not included', inline: false },
    ]);
  });

  it('also retries on a 400 carrying Discord code 40005', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => '{"message": "Request entity too large", "code": 40005}' })
      .mockResolvedValueOnce({ ok: true, text: async () => '' });
    const res = await POST(multipart([png('a.png')]), undefined as never);
    expect(await res.json()).toEqual({ ok: true, attachmentsDropped: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry any other failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => '{"code": 50035}' });
    const res = await POST(multipart([png('a.png')]), undefined as never);
    expect(res.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('502s when the resend fails too', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 413, text: async () => '' });
    const res = await POST(multipart([png('a.png')]), undefined as never);
    expect(res.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never retries a message without files', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 413, text: async () => '' });
    const res = await POST(request(validBody()), undefined as never);
    expect(res.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/requests: Discord unreachable', () => {
  it('answers with a sentence a person can read, not "fetch failed"', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const res = await POST(request(validBody()), undefined as never);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Couldn't send the request, please try again");
  });
});
