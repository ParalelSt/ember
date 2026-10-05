// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

class UnauthorizedError extends Error {}
const getOne = vi.fn();
const update = vi.fn();
const requireUserMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  requireUser: () => requireUserMock(),
  UnauthorizedError,
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/upsertTrack', () => ({
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
const ownIds = vi.fn(async (): Promise<{ id: string }[]> => []);
const sharedWithMock = vi.fn(async (): Promise<{ id: string }[]> => []);
vi.mock('@/lib/playlistAccess', () => ({
  collabClient: async () => ({}),
  sharedWith: () => sharedWithMock(),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { GET, PATCH } = await import('./route');

const request = (body: unknown): NextRequest => ({ json: async () => body, headers: new Headers() }) as unknown as NextRequest;
const call = (fn: typeof GET, body?: unknown) => fn(request(body), undefined as never);

let row: Record<string, unknown>;

beforeEach(() => {
  row = {};
  getOne.mockReset();
  update.mockReset();
  requireUserMock.mockReset();
  ownIds.mockReset();
  ownIds.mockResolvedValue([]);
  sharedWithMock.mockReset();
  sharedWithMock.mockResolvedValue([]);
  requireUserMock.mockResolvedValue({
    user: { id: 'u1' },
    pb: { collection: (name: string) => (name === 'playlists' ? { getFullList: ownIds } : { getOne, update }) },
  });
  getOne.mockImplementation(async () => ({ ...row }));
  update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => {
    row = { ...row, ...patch };
    return { ...row };
  });
});

describe('/api/nav-playlists', () => {
  it('rejects signed-out requests', async () => {
    requireUserMock.mockRejectedValue(new UnauthorizedError());
    expect((await call(GET)).status).toBe(401);
    expect((await call(PATCH, { opened: 'p1' })).status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it('GET reads the signed-in user own row and cleans junk', async () => {
    row = { navPlaylists: { pinned: ['p1', 3], opened: { p1: 5 } } };
    const res = await call(GET);
    expect(await res.json()).toEqual({ pinned: ['p1'], opened: { p1: 5 } });
    expect(getOne).toHaveBeenCalledWith('u1');
  });

  it('PATCH pins and unpins, writing only the caller row', async () => {
    let res = await call(PATCH, { pin: 'p1', pinned: true });
    expect(await res.json()).toEqual({ pinned: ['p1'], opened: {} });
    res = await call(PATCH, { pin: 'p2', pinned: true });
    expect((await res.json()).pinned).toEqual(['p2', 'p1']);
    res = await call(PATCH, { pin: 'p1', pinned: false });
    expect((await res.json()).pinned).toEqual(['p2']);
    for (const [id] of update.mock.calls) expect(id).toBe('u1');
  });

  it('PATCH opened stamps server time and keeps pins', async () => {
    row = { navPlaylists: { pinned: ['p1'], opened: {} } };
    vi.spyOn(Date, 'now').mockReturnValue(4242);
    const res = await call(PATCH, { opened: 'p9' });
    expect(await res.json()).toEqual({ pinned: ['p1'], opened: { p9: 4242 } });
    vi.restoreAllMocks();
  });

  it('cannot target another user: a user id in the body is refused', async () => {
    const res = await call(PATCH, { opened: 'p1', userId: 'u2' });
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects malformed patches', async () => {
    for (const bad of [null, {}, { pin: 'p1' }, { opened: 7 }, { pin: 'a b', pinned: true }]) {
      expect((await call(PATCH, bad)).status).toBe(400);
    }
    expect(update).not.toHaveBeenCalled();
  });

  it('keeps two quick PATCHes from dropping each other', async () => {
    await Promise.all([call(PATCH, { pin: 'a', pinned: true }), call(PATCH, { pin: 'b', pinned: true })]);
    expect((row.navPlaylists as { pinned: string[] }).pinned).toEqual(['b', 'a']);
  });

  it('deleted playlists do not use up the pin cap: a live pin survives a new one', async () => {
    const dead = Array.from({ length: 199 }, (_, i) => `dead${i}`);
    row = { navPlaylists: { pinned: [...dead, 'live1'], opened: {} } };
    ownIds.mockResolvedValue([{ id: 'live1' }, { id: 'fresh' }]);
    const res = await call(PATCH, { pin: 'fresh', pinned: true });
    expect((await res.json()).pinned).toEqual(['fresh', 'live1']);
  });

  it('deleted playlists do not use up the opened cap, and a shared playlist is kept', async () => {
    const opened: Record<string, number> = {};
    for (let i = 0; i < 300; i++) opened[`dead${i}`] = 1000 + i;
    opened.old = 1;
    opened.shared = 2;
    row = { navPlaylists: { pinned: [], opened } };
    ownIds.mockResolvedValue([{ id: 'old' }, { id: 'new1' }]);
    sharedWithMock.mockResolvedValue([{ id: 'shared' }]);
    vi.spyOn(Date, 'now').mockReturnValue(9999);
    const res = await call(PATCH, { opened: 'new1' });
    vi.restoreAllMocks();
    expect((await res.json()).opened).toEqual({ old: 1, shared: 2, new1: 9999 });
  });

  it('when the shared list cannot be read, nothing is pruned', async () => {
    row = { navPlaylists: { pinned: Array.from({ length: 200 }, (_, i) => `p${i}`), opened: {} } };
    sharedWithMock.mockRejectedValue(new Error('admin down'));
    const res = await call(PATCH, { pin: 'p0', pinned: false });
    expect(res.status).toBe(200);
    expect((await res.json()).pinned).toHaveLength(199);
  });
});
