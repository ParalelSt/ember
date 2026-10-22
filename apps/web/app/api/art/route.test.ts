// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const requireUserMock = vi.fn(async () => ({ user: { id: 'u1' } }));
class UnauthorizedError extends Error {}
vi.mock('@/lib/auth', () => ({
  requireUser: () => requireUserMock(),
  UnauthorizedError,
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/upsertTrack', () => ({
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { GET } = await import('./route');
const call = (url: string) => (GET as (r: NextRequest) => Promise<Response>)(new NextRequest(`http://app.test/api/art?url=${encodeURIComponent(url)}`));
const fetchMock = vi.fn();

beforeEach(() => {
  requireUserMock.mockReset();
  requireUserMock.mockResolvedValue({ user: { id: 'u1' } });
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('GET /api/art', () => {
  it('serves an allowed cover from this origin', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }));
    const res = await call('https://i.ytimg.com/vi/abc/hqdefault.jpg');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://i.ytimg.com/vi/abc/hqdefault.jpg');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });

  it('needs a signed-in member', async () => {
    requireUserMock.mockRejectedValue(new UnauthorizedError());
    expect((await call('https://i.ytimg.com/vi/abc/hq.jpg')).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never fetches a host outside the allow list', async () => {
    expect((await call('https://example.com/x.jpg')).status).toBe(400);
    expect((await call('http://169.254.169.254/latest')).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes on only images', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { headers: { 'content-type': 'text/html' } }));
    expect((await call('https://i.ytimg.com/vi/abc/hq.jpg')).status).toBe(502);
  });
});
