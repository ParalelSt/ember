// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { UnauthorizedError } from '@/lib/auth';
import { fakePocketBase, type FakePb } from '@/test-utils/fakePocketBase';

// GET and POST /api/tabs/align: how a tab's alignment with the recording
// stands, and starting it. The job itself (lib/tabAlign.ts) is mocked here;
// this is about who may ask and what the page is told.

const requireUser = vi.fn();
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, requireUser: () => requireUser() };
});
let store: FakePb;
vi.mock('@/lib/pocketbase/server', () => ({ createAdminClient: async () => store.pb }));

const started: string[] = [];
let status: { status: string; timing?: unknown; error?: string } = { status: 'none' };
vi.mock('@/lib/tabAlign', () => ({
  alignmentStatus: () => status,
  alignTab: async (_pb: unknown, row: { id: string }) => {
    started.push(row.id);
    return null;
  },
}));

const route = await import('./align/route');

let n = 0;
const member = (extra: Record<string, unknown> = {}) => ({ id: `m${++n}`, email: `m${n}@x`, isAdmin: false, ...extra });
const as = (u: ReturnType<typeof member> | null) =>
  u ? requireUser.mockResolvedValue({ user: u }) : requireUser.mockRejectedValue(new UnauthorizedError());
const get = (query: string) => route.GET(new NextRequest(`http://t/api/tabs/align${query}`), undefined as never);
const post = (body: unknown) =>
  route.POST(new NextRequest('http://t/api/tabs/align', { method: 'POST', body: JSON.stringify(body) }), undefined as never);

beforeEach(() => {
  store = fakePocketBase({
    tabs: [
      { id: 'shared1', kind: 'fetched', shared: true, file: 'a.alphatex' },
      { id: 'mine1', kind: 'pasted', shared: false, user: 'someone', file: 'b.alphatex' },
    ],
  });
  requireUser.mockReset();
  started.length = 0;
  status = { status: 'none' };
});

describe('/api/tabs/align', () => {
  it('needs a member and a tab id', async () => {
    as(null);
    expect((await get('?tabId=shared1')).status).toBe(401);
    expect((await post({ tabId: 'shared1' })).status).toBe(401);
    as(member());
    expect((await get('')).status).toBe(400);
    expect((await post({})).status).toBe(400);
  });

  it('says how it stands', async () => {
    as(member());
    expect(await (await get('?tabId=shared1')).json()).toEqual({ status: 'none' });
    status = { status: 'ready', timing: { offset_ms: 1350, confidence: 0.9, bpm: 97, bars: [] } };
    expect(await (await get('?tabId=shared1')).json()).toMatchObject({ status: 'ready' });
    status = { status: 'failed', error: 'Ember has no recording for that song yet' };
    expect(await (await get('?tabId=shared1')).json()).toEqual(status);
  });

  it('starts a job and answers at once', async () => {
    as(member());
    const res = await post({ tabId: 'shared1' });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: 'running' });
    expect(started).toEqual(['shared1']);
  });

  it('a tab that is not yours and not shared does not exist', async () => {
    as(member());
    expect((await get('?tabId=mine1')).status).toBe(404);
    expect((await post({ tabId: 'mine1' })).status).toBe(404);
    expect((await get('?tabId=nope')).status).toBe(404);
    expect(started).toEqual([]);
    // An admin may line up anyone's tab.
    as(member({ isAdmin: true }));
    expect((await post({ tabId: 'mine1' })).status).toBe(202);
  });

  it('starting one has a budget per member; joining a running job has none', async () => {
    const m = member();
    as(m);
    let last: Response | null = null;
    for (let i = 0; i < 21; i++) last = await post({ tabId: 'shared1' });
    expect(last!.status).toBe(429);
    status = { status: 'running' };
    expect((await post({ tabId: 'shared1' })).status).toBe(202);
  });
});
