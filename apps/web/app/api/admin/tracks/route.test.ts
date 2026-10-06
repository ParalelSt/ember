// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { fakePocketBase, type FakePb } from '@/test-utils/fakePocketBase';

// Bughunt V13: Admin > Tracks listed catalog rows for deleted uploads as if
// they still played. The row stays (a playlist may hold it), marked missing.

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, requireAdmin: async () => ({ user: { id: 'admin', isAdmin: true } }) };
});
const store = vi.hoisted(() => ({ current: null as FakePb | null }));
vi.mock('@/lib/pocketbase/server', () => ({ createAdminClient: async () => store.current!.pb }));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_n: string, h: unknown) => h }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { GET } = (await import('./route')) as unknown as { GET: (r: NextRequest) => Promise<Response> };

const row = (id: string, source: string, sourceId: string, created: string) => ({
  id, external_id: `${source}:${sourceId}`, source, source_id: sourceId, title: id, artist: 'A', created,
});

beforeEach(() => {
  store.current = fakePocketBase({
    tracks: [
      row('t1', 'upload', 'up_kept', '2026-01-03'),
      row('t2', 'upload', 'up_gone', '2026-01-02'),
      row('t3', 'youtube', 'AAAAAAAAAAA', '2026-01-01'),
    ],
    uploads: [{ id: 'up_kept', title: 'Kept', created: '' }],
  });
});

describe('GET /api/admin/tracks', () => {
  it('marks an uploaded song whose upload was deleted, and only that one', async () => {
    const res = await GET(new NextRequest('http://127.0.0.1/api/admin/tracks'));
    const { tracks } = (await res.json()) as { tracks: { recordId: string; missing?: boolean }[] };
    const byId = Object.fromEntries(tracks.map((t) => [t.recordId, t]));
    expect(byId.t2.missing).toBe(true);
    expect(byId.t1).not.toHaveProperty('missing');
    expect(byId.t3).not.toHaveProperty('missing');
  });
});
