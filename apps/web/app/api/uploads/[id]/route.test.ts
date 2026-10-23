// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    requireUser: async () => ({ user: { id: 'u1', isAdmin: false } }),
    unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  };
});
const pb = vi.hoisted(() => ({
  getOne: vi.fn(),
  remove: vi.fn(async () => true),
}));
vi.mock('@/lib/pocketbase/server', () => ({
  createAdminClient: async () => ({
    collection: () => ({ getOne: pb.getOne, delete: pb.remove }),
  }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/uploads/cover', () => ({ deleteUploadCover: vi.fn(async () => {}) }));
vi.mock('@/lib/uploads', () => ({ resolveUploadPath: () => null }));
const availability = vi.hoisted(() => ({ markTrackUnavailable: vi.fn(async () => {}) }));
vi.mock('@/lib/trackAvailability', () => availability);

const { DELETE } = await import('./route');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const del = (id: string) => DELETE(new Request('http://t', { method: 'DELETE' }) as never, ctx(id));

beforeEach(() => {
  vi.clearAllMocks();
  pb.getOne.mockImplementation(async (id: string) => {
    if (id === 'up1') return { id: 'up1', uploader: 'u1', filename: 'up1.mp3', artwork_ext: '' };
    throw Object.assign(new Error('not found'), { status: 404 });
  });
});

describe('DELETE /api/uploads/[id]', () => {
  it('removes your own upload', async () => {
    const res = await del('up1');
    expect(res.status).toBe(200);
    expect(pb.remove).toHaveBeenCalledWith('up1');
  });

  it('answers a delete with 5xx, not "Upload not found", when PocketBase cannot be reached', async () => {
    pb.getOne.mockRejectedValue(Object.assign(new Error('fetch failed'), { status: 0 }));
    const res = await del('up1');
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(pb.remove).not.toHaveBeenCalled();
  });

  it('marks the song\'s catalog row unavailable, so other people\'s playlists stop offering it', async () => {
    const res = await del('up1');
    expect(res.status).toBe(200);
    expect(availability.markTrackUnavailable).toHaveBeenCalledWith('upload:up1', 'unavailable');
  });

  it('still answers 404 for an upload that really does not exist', async () => {
    const res = await del('nope');
    expect(res.status).toBe(404);
  });
});
