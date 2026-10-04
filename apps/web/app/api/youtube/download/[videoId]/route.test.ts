// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// Saving a song to the host answers "done", never where on the host's disk
// it went: the absolute path tells a member nothing they can use and gives
// away the server's directory layout.

vi.mock('@/lib/sources/youtube', () => ({
  ensureDownloaded: async () => '/home/owner/ember/my_music/abcdefghijk.m4a',
  findCachedFile: () => null,
  isDownloading: () => false,
  isTooLargeError: () => false,
}));
vi.mock('@/lib/downloadAccess', () => ({
  signedInMember: async () => 'u1',
  signInToFetchResponse: () => Response.json({ error: 'sign in' }, { status: 401 }),
  newFetchLimitResponse: () => null,
}));
vi.mock('@/lib/mediaLimits', () => ({ tooLargeResponse: () => Response.json({}, { status: 413 }) }));
vi.mock('@/lib/upsertTrack', () => ({
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

type Handler = (r: NextRequest, ctx: unknown) => Promise<Response>;
const { POST } = (await import('./route')) as unknown as { POST: Handler };

describe('POST /api/youtube/download/[videoId]', () => {
  it('answers ok without the server path', async () => {
    const res = await POST({} as NextRequest, { params: Promise.resolve({ videoId: 'abcdefghijk' }) });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true });
    expect(text).not.toContain('/home/owner');
  });
});
