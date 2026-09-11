// @vitest-environment node
// Node, not happy-dom: this is server code, and happy-dom's FormData drops the
// filename passed with a Blob, which is the thing being asserted here.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { ClientSnapshot } from '@/lib/logger/types';

// Everything the route leans on is stubbed: this is about what reaches the
// Discord webhook, not about auth, rate limiting or triage.
vi.mock('@/lib/auth', () => ({
  requireUser: async () => ({ user: { id: 'u1', email: 'dev@ember.test' } }),
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => new Response('no', { status: 401 }),
}));
vi.mock('@/lib/rateLimit', () => ({ rateLimitResponse: () => null }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { recentSince: async () => [] } }));
vi.mock('@/lib/ai/triage', () => ({ triageBugReport: async () => null }));
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
