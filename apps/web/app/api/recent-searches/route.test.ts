// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Track } from '@/types/track';

/** Two plays of the same search result at once (a double click, two
 *  devices): both find no row and both create one; the second meets the
 *  (user, track) unique index. That is the same as finding the row: bump
 *  it, not a 400 (which the client also files as a bug report). */

type Row = { id: string; user: string; track: string; played_at: string };
const rows: Row[] = [];
let n = 0;
/** The other request's create lands between this one's look-up and create. */
let raceOnce = false;
const unique = () => Object.assign(new Error('Failed to create record.'), { status: 400 });
const notFound = () => Object.assign(new Error('not found'), { status: 404 });

const pb = {
  collection: () => ({
    getFirstListItem: vi.fn(async (filter: string) => {
      const m = /user = "(\w+)" && track = "(\w+)"/.exec(filter);
      const row = rows.find((r) => r.user === m?.[1] && r.track === m?.[2]);
      if (!row) throw notFound();
      return row;
    }),
    create: vi.fn(async (data: Omit<Row, 'id'>) => {
      if (raceOnce) {
        raceOnce = false;
        rows.push({ id: `r${++n}`, ...data });
      }
      if (rows.some((r) => r.user === data.user && r.track === data.track)) throw unique();
      const row = { id: `r${++n}`, ...data };
      rows.push(row);
      return row;
    }),
    update: vi.fn(async (id: string, patch: Partial<Row>) => Object.assign(rows.find((r) => r.id === id)!, patch)),
    getFullList: vi.fn(async () => [...rows]),
    delete: vi.fn(async () => true),
  }),
};

vi.mock('@/lib/auth', () => ({
  requireUser: async () => ({ pb, user: { id: 'u1', email: 'dev@ember.test' } }),
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/upsertTrack', () => ({
  upsertCatalogTrack: vi.fn(async () => 'trk1'),
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  fromError: (e: { status?: number; message?: string }) => Response.json({ error: e.message }, { status: e.status ?? 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_r: string, handler: unknown) => handler }));

const { POST } = await import('./route');

const track = { id: 'youtube:abcdefghijk', source: 'youtube', sourceId: 'abcdefghijk', title: 'Song' } as Track;
const request = (body: unknown) => ({ json: async () => body, headers: new Headers() }) as unknown as NextRequest;

beforeEach(() => {
  rows.length = 0;
  raceOnce = false;
});

describe('POST /api/recent-searches', () => {
  it('a second play at the same moment bumps the row the first one made', async () => {
    raceOnce = true;
    const res = await POST(request({ track }));
    expect(res.status).toBe(201);
    expect(rows).toHaveLength(1);
  });

  it('a first play still creates the row', async () => {
    const res = await POST(request({ track }));
    expect(res.status).toBe(201);
    expect(rows).toHaveLength(1);
  });
});
