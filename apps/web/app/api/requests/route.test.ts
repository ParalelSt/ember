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
vi.mock('@/lib/rateLimit', () => ({ rateLimitResponse: () => rateLimitMock() }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn() } }));
vi.mock('@/lib/upsertTrack', () => ({
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { POST } = await import('./route');

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
});

describe('POST /api/requests: Discord failure', () => {
  it('502s when Discord rejects the post', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'server error' });
    const res = await POST(request(validBody()), undefined as never);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Couldn't send the request, please try again" });
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
