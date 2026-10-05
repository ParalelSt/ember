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
vi.mock('@/lib/pocketbase/server', () => ({
  createAdminClient: async () => ({ collection: () => ({ create }) }),
}));
vi.mock('@/lib/rateLimit', () => ({ rateLimitResponse: () => null }));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/uploads/cover', () => ({ saveUploadCover: async () => null }));

const { POST } = await import('./route');
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
