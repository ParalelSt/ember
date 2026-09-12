import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UnauthorizedError } from '@/lib/auth';

// MUSIC_DIR is read when lib/uploads loads, so set it before importing anything
// that pulls it in.
const musicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'art-route-test-'));
process.env.MUSIC_DIR = musicDir;

const requireUser = vi.fn();
const getOne = vi.fn();

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, requireUser: () => requireUser() };
});

vi.mock('@/lib/pocketbase/server', () => ({
  createAdminClient: async () => ({ collection: () => ({ getOne: (id: string) => getOne(id) }) }),
}));

const { GET } = await import('./route');
const { UPLOAD_DIR } = await import('@/lib/uploads');

/** The route's second argument is Next's generated RouteContext, which only
 *  exists at build time; this is the shape it actually hands over. */
function ctx(id: string) {
  return { params: Promise.resolve({ id }) } as Parameters<typeof GET>[1];
}

/** withRequestLog types its handler's first argument as NextRequest, but only
 *  ever reads `headers` and `method` off it, so a plain Request is enough. */
function req(url = 'http://t'): Parameters<typeof GET>[0] {
  return new Request(url) as Parameters<typeof GET>[0];
}

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);

beforeEach(() => {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  requireUser.mockResolvedValue({ user: { id: 'u1', email: 'a@b.c', isAdmin: false } });
  getOne.mockReset();
});

afterEach(() => {
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('GET /api/uploads/[id]/art', () => {
  it('serves the cover with its content type and a long cache', async () => {
    fs.writeFileSync(path.join(UPLOAD_DIR, 'rec1.png'), PNG_BYTES);
    getOne.mockResolvedValue({ id: 'rec1', artwork_ext: 'png' });

    const res = await GET(req('http://t/api/uploads/rec1/art'), ctx('rec1'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable');
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG_BYTES)).toBe(true);
  });

  it('serves a JPEG cover as image/jpeg', async () => {
    fs.writeFileSync(path.join(UPLOAD_DIR, 'rec2.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
    getOne.mockResolvedValue({ id: 'rec2', artwork_ext: 'jpg' });

    const res = await GET(req('http://t/api/uploads/rec2/art'), ctx('rec2'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
  });

  it('404s for an upload with no recorded cover', async () => {
    getOne.mockResolvedValue({ id: 'rec3' });
    expect((await GET(req(), ctx('rec3'))).status).toBe(404);
  });

  it('404s when the record claims a cover the disk does not have', async () => {
    getOne.mockResolvedValue({ id: 'rec4', artwork_ext: 'jpg' });
    expect((await GET(req(), ctx('rec4'))).status).toBe(404);
  });

  it('404s when the cover file on disk is empty', async () => {
    fs.writeFileSync(path.join(UPLOAD_DIR, 'rec5.png'), Buffer.alloc(0));
    getOne.mockResolvedValue({ id: 'rec5', artwork_ext: 'png' });
    expect((await GET(req(), ctx('rec5'))).status).toBe(404);
  });

  it('404s for an unknown upload', async () => {
    getOne.mockRejectedValue(new Error('404'));
    expect((await GET(req(), ctx('nope'))).status).toBe(404);
  });

  it('401s when nobody is signed in, without touching PocketBase', async () => {
    requireUser.mockRejectedValue(new UnauthorizedError());

    const res = await GET(req(), ctx('rec1'));

    expect(res.status).toBe(401);
    expect(getOne).not.toHaveBeenCalled();
  });

  it('500s rather than leaking the error when something else goes wrong', async () => {
    requireUser.mockRejectedValue(new Error('pocketbase is down'));

    const res = await GET(req(), ctx('rec1'));

    expect(res.status).toBe(500);
    expect(await res.text()).toBe('artwork failed');
  });
});
