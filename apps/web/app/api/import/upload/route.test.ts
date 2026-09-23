// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { NextRequest } from 'next/server';
import { MAX_UPLOAD_BYTES } from '@/lib/import/sources/index';

// The upload route with the store and the runner faked: what is checked here
// is the gate (auth, rate limit, size), what the parser was handed, and the
// shape of the two answers (a preview, or a queued job).

const FIXTURES = path.resolve(__dirname, '../../../../../../tests/fixtures/imports/transfer');
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name));

const requireUserMock = vi.fn(async () => ({ user: { id: 'u1', email: 'dev@ember.test' } }));
vi.mock('@/lib/auth', () => ({
  requireUser: () => requireUserMock(),
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
const rateLimitKeys: string[] = [];
const rateLimitMock = vi.fn(() => null as Response | null);
vi.mock('@/lib/rateLimit', () => ({
  rateLimitResponse: (key: string) => {
    rateLimitKeys.push(key);
    return rateLimitMock();
  },
}));
vi.mock('@/lib/upsertTrack', () => ({
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_route: string, handler: unknown) => handler }));
vi.mock('@/lib/pocketbase/server', () => ({ createAdminClient: vi.fn(async () => ({ pb: true })) }));
const kick = vi.fn();
vi.mock('@/lib/import/runnerInstance', () => ({ kickImportRunner: () => kick() }));
/** Every `createImportJob` call's second argument: what the parsers handed
 *  the route. */
const newImports: Record<string, unknown>[] = [];
const createImportJob = vi.fn(async (_pb: unknown, n: Record<string, unknown>) => {
  newImports.push(n);
  return { job: { id: 'j1', kind: 'liked' }, playlistId: null };
});
vi.mock('@/lib/import/store', () => ({
  createImportJob: (pb: unknown, n: Record<string, unknown>) => createImportJob(pb, n),
}));

const { POST } = await import('./route');

function jsonRequest(body: unknown, query = ''): NextRequest {
  return {
    url: `http://127.0.0.1/api/import/upload${query}`,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as unknown as NextRequest;
}

function fileRequest(name: string, bytes: Buffer, query = '', destination?: string): NextRequest {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(bytes)], name));
  if (destination) form.append('destination', destination);
  return {
    url: `http://127.0.0.1/api/import/upload${query}`,
    headers: new Headers({ 'content-type': 'multipart/form-data; boundary=x' }),
    formData: async () => form,
  } as unknown as NextRequest;
}

const body = async (res: Response) => (await res.json()) as Record<string, never>;

beforeEach(() => {
  rateLimitMock.mockReturnValue(null);
  rateLimitKeys.length = 0;
  newImports.length = 0;
  createImportJob.mockClear();
  kick.mockClear();
});

describe('POST /api/import/upload, the gate', () => {
  it('is rate limited per user, by the hour', async () => {
    rateLimitMock.mockReturnValueOnce(Response.json({ error: 'slow down' }, { status: 429 }));
    const res = await POST(jsonRequest({ text: 'A - B' }), {});
    expect(res.status).toBe(429);
    expect(rateLimitKeys).toEqual(['import-upload:u1']);
    expect(createImportJob).not.toHaveBeenCalled();
  });

  it('turns away a body that says it is over 20 MB before reading it', async () => {
    const req = {
      url: 'http://127.0.0.1/api/import/upload',
      headers: new Headers({ 'content-type': 'application/json', 'content-length': String(MAX_UPLOAD_BYTES + 1) }),
      json: async () => ({ text: 'A - B' }),
    } as unknown as NextRequest;
    const res = await POST(req, {});
    expect(res.status).toBe(413);
    expect((await body(res)).error).toContain('20 MB');
  });

  it('turns away an over-size file part too', async () => {
    const big = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
    expect((await POST(fileRequest('huge.csv', big), {})).status).toBe(413);
  });

  it('an empty body says what to do', async () => {
    expect((await POST(jsonRequest({}), {})).status).toBe(400);
    expect((await POST(jsonRequest({ text: '   ' }), {})).status).toBe(400);
  });

  it('a file Ember cannot read is a 422 with the reason', async () => {
    const res = await POST(fileRequest('export.csv', fixture('no-title-column.sample.csv')), {});
    expect(res.status).toBe(422);
    expect((await body(res)).error).toContain('song column');
  });

  it('a zip is refused with the one thing to do about it', async () => {
    const res = await POST(fileRequest('my_spotify_data.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])), {});
    expect(res.status).toBe(422);
    expect((await body(res)).error).toContain('Unzip it');
  });

  it('a UTF-16 file is refused rather than read as gibberish', async () => {
    const res = await POST(fileRequest('utf16.csv', fixture('utf16.sample.csv')), {});
    expect(res.status).toBe(422);
    expect((await body(res)).error).toContain('UTF-16');
  });
});

describe('POST /api/import/upload?preview=1', () => {
  it('[bughunt W06] never touches the hourly import-start limit', async () => {
    await POST(fileRequest('exportify.csv', fixture('exportify.sample.csv'), '?preview=1'), {});
    expect(rateLimitKeys).toEqual([]);
  });

  it('[bughunt W06] many previews in a row still leave a real start free', async () => {
    for (let i = 0; i < 20; i++) {
      const res = await POST(fileRequest('exportify.csv', fixture('exportify.sample.csv'), '?preview=1'), {});
      expect(res.status).toBe(200);
    }
    expect(rateLimitKeys).toEqual([]);
    const started = await POST(fileRequest('YourLibrary.json', fixture('YourLibrary.sample.json')), {});
    expect(started.status).toBe(201);
    expect(rateLimitKeys).toEqual(['import-upload:u1']);
  });

  it('says what is in the file without starting anything', async () => {
    const res = await POST(fileRequest('exportify.csv', fixture('exportify.sample.csv'), '?preview=1'), {});
    expect(res.status).toBe(200);
    const { preview } = (await res.json()) as { preview: Record<string, unknown> };
    expect(preview).toMatchObject({
      kind: 'csv',
      label: 'Liked songs from Spotify',
      order: 'oldest-first',
      count: 3,
      dropped: 0,
      truncated: false,
    });
    expect((preview.sample as { title: string }[])[0].title).toBe('Paper Lanterns');
    expect(createImportJob).not.toHaveBeenCalled();
    expect(kick).not.toHaveBeenCalled();
  });

  it('shows at most five songs, however long the list', async () => {
    const many = Array.from({ length: 40 }, (_, i) => `Artist ${i} - Song ${i}`).join('\n');
    const res = await POST(jsonRequest({ text: many }, '?preview=1'), {});
    const { preview } = (await res.json()) as { preview: { count: number; sample: unknown[] } };
    expect(preview.count).toBe(40);
    expect(preview.sample).toHaveLength(5);
  });

  it('says so when the list was longer than one transfer may carry', async () => {
    const many = Array.from({ length: 10_001 }, (_, i) => `Artist ${i} - Song ${i}`).join('\n');
    const res = await POST(jsonRequest({ text: many }, '?preview=1'), {});
    const { preview } = (await res.json()) as { preview: { truncated: boolean; count: number } };
    expect(preview).toMatchObject({ truncated: true, count: 10_000 });
  });
});

describe('POST /api/import/upload, starting the transfer', () => {
  it('queues a liked job from a file and kicks the runner', async () => {
    const res = await POST(fileRequest('YourLibrary.json', fixture('YourLibrary.sample.json')), {});
    expect(res.status).toBe(201);
    expect(await body(res)).toMatchObject({ job: { id: 'j1' }, playlistId: null });
    const arg = newImports[0];
    expect(arg).toMatchObject({
      userId: 'u1',
      kind: 'liked',
      source: 'spotify-export',
      name: 'Liked songs from Spotify',
      order: 'unknown',
      coverUrl: null,
    });
    expect((arg.items as unknown[]).length).toBe(4);
    expect(kick).toHaveBeenCalled();
  });

  it('queues a liked job from pasted text', async () => {
    await POST(jsonRequest({ text: 'Halcyon Drift - Paper Lanterns\nMirror Hall - Cold Open' }), {});
    const arg = newImports[0];
    expect(arg).toMatchObject({ kind: 'liked', source: 'paste', name: 'Liked songs from a list', order: 'newest-first' });
  });

  it('can put the same file into a playlist instead, named without the "Liked songs from"', async () => {
    await POST(fileRequest('exportify.csv', fixture('exportify.sample.csv'), '', 'playlist'), {});
    const arg = newImports[0];
    expect(arg).toMatchObject({ kind: 'playlist', name: 'Spotify' });
  });

  it('refuses to start a list longer than one transfer may carry, and says what to do', async () => {
    const many = Array.from({ length: 10_001 }, (_, i) => `Artist ${i} - Song ${i}`).join('\n');
    const res = await POST(jsonRequest({ text: many }), {});
    expect(res.status).toBe(413);
    expect((await body(res)).error).toContain('Split the file');
    expect(createImportJob).not.toHaveBeenCalled();
  });
});
