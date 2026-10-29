// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/** GET /api/radio/logo/[id]: members only, a station id and never an
 *  address, the logo Radio Browser listed, kept by the browser a week. */

const ID = '00000000-0000-4000-8000-000000000001';
const NO_LOGO = '00000000-0000-4000-8000-000000000002';

let signedIn: string | null = 'u1';
vi.mock('@/lib/auth', () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
    requireUser: async () => {
      if (!signedIn) throw new UnauthorizedError();
      return { pb: {}, user: { id: signedIn, email: '', isAdmin: false } };
    },
  };
});
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_n: string, h: unknown) => h }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const svc = vi.hoisted(() => ({
  station: vi.fn(async (id: string) => {
    if (id === '00000000-0000-4000-8000-000000000001') return { id, favicon: 'https://logo.example/icon.png' };
    if (id === '00000000-0000-4000-8000-000000000002') return { id, favicon: null };
    return null;
  }),
}));
vi.mock('@/lib/radio/service', () => ({ radioService: () => svc }));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const proxy = vi.hoisted(() => ({ fetchLogo: vi.fn() }));
vi.mock('@/lib/radio/logoProxy', () => proxy);

const { _resetBuckets } = await import('@/lib/rateLimit');
const { GET } = await import('./route');

const call = (id: string, query = '') =>
  GET(new NextRequest(`http://localhost/api/radio/logo/${id}${query}`), { params: Promise.resolve({ id }) } as never);

beforeEach(() => {
  signedIn = 'u1';
  _resetBuckets();
  vi.clearAllMocks();
  proxy.fetchLogo.mockResolvedValue({ type: 'image/png', bytes: PNG });
});

describe('GET /api/radio/logo/[id]', () => {
  it('serves the logo Radio Browser listed, typed by its bytes and cached for a week', async () => {
    const res = await call(ID);
    expect(res.status).toBe(200);
    expect(proxy.fetchLogo).toHaveBeenCalledWith('https://logo.example/icon.png', expect.objectContaining({ userAgent: expect.any(String) }));
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=604800, immutable');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PNG);
  });

  it('ignores any address the client sends', async () => {
    await call(ID, '?url=http://127.0.0.1:8090/');
    expect(proxy.fetchLogo).toHaveBeenCalledWith('https://logo.example/icon.png', expect.anything());
  });

  it('is for members only', async () => {
    signedIn = null;
    expect((await call(ID)).status).toBe(401);
    expect(proxy.fetchLogo).not.toHaveBeenCalled();
  });

  it('answers 400 for a malformed id, 404 for an unknown station or one with no logo', async () => {
    expect((await call('..%2Fx')).status).toBe(400);
    expect((await call('00000000-0000-4000-8000-000000000009')).status).toBe(404);
    expect((await call(NO_LOGO)).status).toBe(404);
    expect(proxy.fetchLogo).not.toHaveBeenCalled();
  });

  it('answers 502, never cached, when the logo cannot be fetched', async () => {
    proxy.fetchLogo.mockRejectedValueOnce(new Error('not an image'));
    const res = await call(ID);
    expect(res.status).toBe(502);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('has its own budget, apart from browsing', async () => {
    for (let i = 0; i < 100; i++) expect((await call(ID)).status).toBe(200);
  });
});
