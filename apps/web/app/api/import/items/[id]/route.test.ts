// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// Settling one song by hand, with PocketBase and the store faked: what is
// checked is which store call each action reaches, and the refusals.

const records: Record<string, Record<string, unknown>> = {};
const userPb = {
  collection: (name: string) => ({
    getOne: async (id: string) => {
      const r = records[`${name}:${id}`];
      if (!r) throw Object.assign(new Error('nf'), { status: 404 });
      return r;
    },
  }),
};
vi.mock('@/lib/auth', () => ({
  requireUser: async () => ({ pb: userPb, user: { id: 'u1' } }),
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/upsertTrack', () => ({
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_route: string, handler: unknown) => handler }));
vi.mock('@/lib/pocketbase/server', () => ({ createAdminClient: vi.fn(async () => userPb) }));
const store = vi.hoisted(() => ({ pickItem: vi.fn(), skipItem: vi.fn(), undoItem: vi.fn() }));
vi.mock('@/lib/import/store', () => store);

const { POST } = await import('./route');
const request = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const ctx = { params: Promise.resolve({ id: 'i1' }) } as never;

function item(status: string) {
  records['import_items:i1'] = {
    id: 'i1',
    job: 'j1',
    position: 0,
    status,
    source_title: 'Paper Lanterns',
    source_artist: 'Halcyon Drift',
    candidates: [],
    video_id: status === 'resolved' ? 'vid1' : '',
  };
  records['import_jobs:j1'] = { id: 'j1', user: 'u1', kind: 'liked', status: 'done' };
}

beforeEach(() => {
  for (const k of Object.keys(records)) delete records[k];
  for (const fn of Object.values(store)) fn.mockReset();
});

describe('POST /api/import/items/:id, undo', () => {
  it('puts a used song back to check', async () => {
    item('resolved');
    const res = await POST(request({ action: 'undo', to: 'review' }), ctx);
    expect(res.status).toBe(200);
    expect(store.undoItem).toHaveBeenCalledWith(userPb, expect.objectContaining({ id: 'j1' }), expect.objectContaining({ id: 'i1' }), 'review');
  });

  it('puts a skipped song back as not found', async () => {
    item('skipped');
    await POST(request({ action: 'undo', to: 'missing' }), ctx);
    expect(store.undoItem.mock.calls[0][3]).toBe('missing');
  });

  it('refuses a song that was never decided, and a status it cannot go back to', async () => {
    item('review');
    expect((await POST(request({ action: 'undo', to: 'review' }), ctx)).status).toBe(409);
    item('resolved');
    expect((await POST(request({ action: 'undo', to: 'accepted' }), ctx)).status).toBe(400);
    expect(store.undoItem).not.toHaveBeenCalled();
  });

  it('only for the owner of the import', async () => {
    item('resolved');
    records['import_jobs:j1'].user = 'someone-else';
    expect((await POST(request({ action: 'undo', to: 'review' }), ctx)).status).toBe(404);
  });
});
