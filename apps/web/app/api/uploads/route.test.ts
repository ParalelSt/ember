// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    requireUser: async () => ({ user: { id: 'u1', isAdmin: false } }),
    unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  };
});
const create = vi.fn();
/** 250 uploads, newest first, as PocketBase pages them. */
const rows = Array.from({ length: 250 }, (_, i) => ({ id: `up${i}`, uploader: 'other1', title: `Song ${i}`, artist: '', album: '', filename: `${i}.mp3` }));
vi.mock('@/lib/pocketbase/server', () => ({
  createAdminClient: async () => ({
    collection: () => ({
      create,
      getList: async (page: number, perPage: number) => ({ items: rows.slice((page - 1) * perPage, page * perPage), totalItems: rows.length }),
      getFullList: async () => rows,
    }),
  }),
}));
vi.mock('@/lib/rateLimit', () => ({ rateLimitResponse: () => null }));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/uploads/cover', () => ({ saveUploadCover: async () => null }));

const { GET, POST } = await import('./route');
const { MAX_UPLOAD_BYTES } = await import('@/lib/uploads');

describe('POST /api/uploads', () => {
  it('a file over the limit is a 413 with the limit, even when the proxy cut the body short', async () => {
    // proxy.ts buffers at most proxyClientMaxBodySize, so a bigger song
    // arrives as a truncated multipart body that formData() cannot read.
    const boundary = 'x';
    const truncated = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.mp3"\r\nContent-Type: audio/mpeg\r\n\r\nID3partial`;
    const req = new NextRequest('http://ember.test/api/uploads', {
      method: 'POST',
      body: truncated,
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(MAX_UPLOAD_BYTES * 2),
      },
    });
    const res = await POST(req, undefined as never);
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/too large/i);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('GET /api/uploads', () => {
  it('lists every upload on the server, not only the newest 200', async () => {
    const res = await GET(new Request('http://t/api/uploads') as never, undefined as never);
    expect(res.status).toBe(200);
    const { tracks } = await res.json();
    expect(tracks).toHaveLength(250);
    expect(tracks[0].id).toBe('upload:up0');
  });
});
