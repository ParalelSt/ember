// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// The link route with the source look-up and the store faked: what is checked
// here is the destination, which decides whether a playlist is made at all.

const requireUserMock = vi.fn(async () => ({ user: { id: 'u1', email: 'dev@ember.test' } }));
vi.mock('@/lib/auth', () => ({
  requireUser: () => requireUserMock(),
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
const rateLimitMock = vi.fn(() => null as Response | null);
vi.mock('@/lib/rateLimit', () => ({ rateLimitResponse: () => rateLimitMock() }));
vi.mock('@/lib/upsertTrack', () => ({
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_route: string, handler: unknown) => handler }));
vi.mock('@/lib/pocketbase/server', () => ({ createAdminClient: vi.fn(async () => ({ pb: true })) }));
vi.mock('@/lib/import/runnerInstance', () => ({ kickImportRunner: vi.fn() }));
vi.mock('@/lib/import/inspect', () => ({
  inspectLink: vi.fn(async () => ({
    source: 'spotify',
    id: 'sp1',
    name: 'Road trip',
    coverUrl: 'https://i.scdn.co/image/a',
    truncated: false,
    items: [
      { position: 0, title: 'A', artists: ['X'], artist: 'X', durationMs: 1000, explicit: null, uri: null },
      { position: 1, title: 'B', artists: ['Y'], artist: 'Y', durationMs: 1000, explicit: null, uri: null },
    ],
  })),
}));
interface JobResult {
  job: { id: string; coverUrl: string | null };
  playlistId: string | null;
}
/** Every `createImportJob` call's second argument, which is the whole point
 *  of these checks. */
const newImports: Record<string, unknown>[] = [];
let jobResult: JobResult = { job: { id: 'j1', coverUrl: 'https://i.scdn.co/image/a' }, playlistId: 'p1' };
const attachCover = vi.fn();
const createImportJob = vi.fn(async (_pb: unknown, n: Record<string, unknown>) => {
  newImports.push(n);
  return jobResult;
});
vi.mock('@/lib/import/store', () => ({
  createImportJob: (pb: unknown, n: Record<string, unknown>) => createImportJob(pb, n),
  attachCover: () => attachCover(),
}));

const { POST } = await import('./route');

const request = (body: unknown) =>
  ({ url: 'http://127.0.0.1/api/import/jobs', headers: new Headers(), json: async () => body }) as unknown as NextRequest;
const LINK = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';

beforeEach(() => {
  rateLimitMock.mockReturnValue(null);
  newImports.length = 0;
  createImportJob.mockClear();
  attachCover.mockClear();
  jobResult = { job: { id: 'j1', coverUrl: 'https://i.scdn.co/image/a' }, playlistId: 'p1' };
});

describe('POST /api/import/jobs', () => {
  it('makes a playlist named after the source by default', async () => {
    const res = await POST(request({ url: LINK }), {});
    expect(res.status).toBe(201);
    expect(newImports[0]).toMatchObject({
      kind: 'playlist',
      name: 'Road trip',
      coverUrl: 'https://i.scdn.co/image/a',
    });
    expect(attachCover).toHaveBeenCalled();
  });

  it('a liked destination makes no playlist, and the job says where the songs came from', async () => {
    jobResult = { job: { id: 'j2', coverUrl: null }, playlistId: null };
    const res = await POST(request({ url: LINK, destination: 'liked' }), {});
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ playlistId: null });
    expect(newImports[0]).toMatchObject({
      kind: 'liked',
      name: 'Liked songs from Spotify',
      coverUrl: null,
      // A playlist reads top down, so its first song is the oldest like.
      order: 'oldest-first',
    });
    expect(attachCover).not.toHaveBeenCalled();
  });

  it('anything but "liked" is a playlist import', async () => {
    await POST(request({ url: LINK, destination: 'somewhere else' }), {});
    expect(newImports[0]).toMatchObject({ kind: 'playlist' });
  });

  it('still needs a link Ember can read', async () => {
    expect((await POST(request({ url: 'https://example.com/nope', destination: 'liked' }), {})).status).toBe(400);
    expect(createImportJob).not.toHaveBeenCalled();
  });
});
