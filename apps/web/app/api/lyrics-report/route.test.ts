// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const requireUserMock = vi.fn(async () => ({ user: { id: 'u1', email: 'dev@ember.test' } }));
vi.mock('@/lib/auth', () => ({
  requireUser: () => requireUserMock(),
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/rateLimit', () => ({ rateLimitResponse: () => null }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/upsertTrack', () => ({
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { POST } = await import('./route');

function request(body: unknown): NextRequest {
  return { json: async () => body, headers: new Headers() } as unknown as NextRequest;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.DISCORD_BUG_REPORT_WEBHOOK_URL = 'http://127.0.0.1:4321/bugs';
  fetchMock = vi.fn().mockImplementation(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
});

async function postedEmbed() {
  const [, init] = fetchMock.mock.calls.at(-1) as [string, { body: FormData }];
  return JSON.parse(String(init.body.get('payload_json'))).embeds[0] as { description: string };
}

describe('POST /api/lyrics-report', () => {
  it('scrubs secrets out of the note before it goes to Discord', async () => {
    const res = await POST(request({ trackTitle: 'Song', note: 'wrong words, Authorization: Bearer abcdef0123456789abcdef' }), undefined as never);
    expect(res.status).toBe(200);
    const embed = await postedEmbed();
    expect(embed.description).toContain('wrong words');
    expect(embed.description).not.toContain('abcdef0123456789abcdef');
  });

  it('answers a plain sentence when Discord cannot be reached, without the network error text', async () => {
    fetchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND discord.com at 10.0.0.7'));
    const res = await POST(request({ trackTitle: 'Song' }), undefined as never);
    expect(res.status).toBe(502);
    const { error } = await res.json();
    expect(error).not.toMatch(/unreachable|ENOTFOUND|10\.0\.0\.7/);
  });

  it('does not echo the body Discord rejected with', async () => {
    fetchMock.mockResolvedValue(new Response('{"message":"Invalid Webhook Token","code":50027}', { status: 401 }));
    const res = await POST(request({ trackTitle: 'Song' }), undefined as never);
    expect(res.status).toBe(502);
    const { error } = await res.json();
    expect(error).not.toContain('Invalid Webhook Token');
  });
});
