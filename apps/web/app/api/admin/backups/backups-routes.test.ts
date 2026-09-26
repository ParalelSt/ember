// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import type { NextRequest } from 'next/server';

// The admin gate is the point of these routes (they hand out the whole
// database), so every route is driven as admin, member and signed out. The
// PocketBase superuser client is a fake; lib/backups.ts runs for real on it.
const state = vi.hoisted(() => ({
  role: 'admin' as 'admin' | 'member' | 'anon',
  backups: [] as { key: string; size: number; modified: string }[],
  createError: null as null | { status: number; message: string; response?: { message?: string } },
  fetchCalls: [] as string[],
  adminClientCalls: 0,
}));

const fakePb = {
  backups: {
    getFullList: vi.fn(async () => state.backups),
    create: vi.fn(async () => {
      if (state.createError) throw state.createError;
      state.backups.push({ key: 'pb_backup_ember_20260926120000.zip', size: 2048, modified: '2026-09-26 12:00:00.000Z' });
    }),
    getDownloadURL: (token: string, key: string) =>
      `http://pb.test/api/backups/${encodeURIComponent(key)}?token=${token}`,
  },
  files: { getToken: vi.fn(async () => 'file-token') },
  settings: { getAll: vi.fn(async () => ({ backups: { cron: '0 4 * * *', cronMaxKeep: 7, s3: { enabled: false } } })) },
};

vi.mock('@/lib/auth', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthorizedError,
    ForbiddenError,
    requireAdmin: async () => {
      if (state.role === 'anon') throw new UnauthorizedError();
      if (state.role === 'member') throw new ForbiddenError();
      return { user: { id: 'u1', email: 'admin@ember.test', isAdmin: true } };
    },
    unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
    forbiddenResponse: () => Response.json({ error: 'Forbidden' }, { status: 403 }),
  };
});
vi.mock('@/lib/pocketbase/server', () => ({
  createAdminClient: async () => {
    state.adminClientCalls++;
    return fakePb;
  },
}));
vi.mock('@/lib/upsertTrack', () => ({
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

let music: string;
const prevMusic = process.env.MUSIC_DIR;

beforeAll(() => {
  music = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-backup-routes-'));
  fs.mkdirSync(path.join(music, 'uploads'));
  fs.writeFileSync(path.join(music, 'uploads', 'song.mp3'), 'audio-bytes');
  fs.writeFileSync(path.join(music, 'cached.m4a'), 'youtube');
  process.env.MUSIC_DIR = music;
});
afterAll(() => {
  fs.rmSync(music, { recursive: true, force: true });
  if (prevMusic === undefined) delete process.env.MUSIC_DIR;
  else process.env.MUSIC_DIR = prevMusic;
  vi.unstubAllGlobals();
});

const list = await import('./route');
const one = await import('./[name]/route');
const files = await import('./member-files/route');

const req = () => ({}) as NextRequest;
const ctx = (name: string) => ({ params: Promise.resolve({ name }) }) as never;

const BIG = 'x'.repeat(200_000);

beforeEach(() => {
  vi.clearAllMocks();
  state.role = 'admin';
  state.createError = null;
  state.adminClientCalls = 0;
  state.fetchCalls = [];
  state.backups = [
    { key: '@auto_pb_backup_ember_20260925040000.zip', size: 1000, modified: '2026-09-25 04:00:00.000Z' },
    { key: '@auto_pb_backup_ember_20260926040000.zip', size: 1200, modified: '2026-09-26 04:00:00.000Z' },
  ];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    state.fetchCalls.push(url);
    // A body delivered in several chunks, like a real large download.
    const chunks = [BIG.slice(0, 100_000), BIG.slice(100_000)];
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        const next = chunks.shift();
        if (next === undefined) c.close();
        else c.enqueue(new TextEncoder().encode(next));
      },
    });
    return new Response(body, { status: 200, headers: { 'content-length': String(BIG.length) } });
  }));
});

describe('refuses anyone but an admin, before touching PocketBase', () => {
  const calls: [string, () => Response | Promise<Response>][] = [
    ['GET /api/admin/backups', () => list.GET(req(), undefined as never)],
    ['POST /api/admin/backups', () => list.POST(req(), undefined as never)],
    ['GET /api/admin/backups/[name]', () => one.GET(req(), ctx('@auto_pb_backup_ember_20260926040000.zip'))],
    ['GET /api/admin/backups/member-files', () => files.GET(req(), undefined as never)],
  ];
  for (const [label, call] of calls) {
    it(`${label}: 403 for a member, 401 signed out`, async () => {
      state.role = 'member';
      expect((await call()).status).toBe(403);
      state.role = 'anon';
      expect((await call()).status).toBe(401);
      expect(state.adminClientCalls).toBe(0);
      expect(fakePb.backups.create).not.toHaveBeenCalled();
      expect(state.fetchCalls).toEqual([]);
    });
  }
});

describe('GET /api/admin/backups', () => {
  it('lists backups newest first with the schedule, disk and member files', async () => {
    const res = await list.GET(req(), undefined as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.backups.map((b: { name: string }) => b.name)).toEqual([
      '@auto_pb_backup_ember_20260926040000.zip',
      '@auto_pb_backup_ember_20260925040000.zip',
    ]);
    expect(body.backups[0]).toMatchObject({ size: 1200, modified: '2026-09-26T04:00:00.000Z', auto: true });
    expect(body.schedule).toEqual({ cron: '0 4 * * *', keep: 7, s3: false });
    expect(body.disk.free).toBeGreaterThan(0);
    expect(typeof body.disk.low).toBe('boolean');
    // Only the upload counts; the cached YouTube file is not a member file.
    expect(body.memberFiles).toEqual({ files: 1, bytes: 'audio-bytes'.length });
  });

  it('still answers when the settings cannot be read', async () => {
    fakePb.settings.getAll.mockRejectedValueOnce(new Error('nope'));
    const body = await (await list.GET(req(), undefined as never)).json();
    expect(body.schedule).toBeNull();
    expect(body.backups).toHaveLength(2);
  });
});

describe('POST /api/admin/backups', () => {
  it('makes a backup and answers with the new list', async () => {
    const res = await list.POST(req(), undefined as never);
    expect(res.status).toBe(200);
    expect(fakePb.backups.create).toHaveBeenCalledWith('');
    const body = await res.json();
    expect(body.backups[0].name).toBe('pb_backup_ember_20260926120000.zip');
    expect(body.backups[0].auto).toBe(false);
  });

  it('says so when a backup is already running', async () => {
    const busy = 'Try again later - another backup/restore process has already been started.';
    state.createError = { status: 400, message: busy, response: { message: busy } };
    const res = await list.POST(req(), undefined as never);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already running/);
  });

  it('passes a failed backup through as an error, not as "already running"', async () => {
    state.createError = { status: 400, message: 'Failed to create backup.', response: { message: 'Failed to create backup.' } };
    const res = await list.POST(req(), undefined as never);
    expect(res.status).toBe(500);
    expect((await res.json()).error).not.toMatch(/already running/);
  });
});

describe('GET /api/admin/backups/[name]', () => {
  it('streams the backup from PocketBase as an attachment', async () => {
    const name = '@auto_pb_backup_ember_20260926040000.zip';
    const res = await one.GET(req(), ctx(encodeURIComponent(name)));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="${name}"`);
    expect(res.headers.get('content-length')).toBe(String(BIG.length));
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    expect(state.fetchCalls).toEqual([`http://pb.test/api/backups/${encodeURIComponent(name)}?token=file-token`]);
    // A stream, passed through as is, not a buffered copy.
    expect(res.body).toBeInstanceOf(ReadableStream);
    expect(await res.text()).toBe(BIG);
  });

  it('refuses path traversal and odd names without asking PocketBase', async () => {
    for (const bad of [
      '../data.db',
      encodeURIComponent('../data.db'),
      '..%2F..%2Fpb_data%2Fdata.db',
      '%2e%2e%2fdata.db',
      'sub%2Fx.zip',
      '..%5Cx.zip',
      'data.db',
      '%E0%A4%A',
      '@auto_pb_backup_ember_20260926040000.zip.attrs',
    ]) {
      const res = await one.GET(req(), ctx(bad));
      expect(res.status, bad).toBe(400);
    }
    expect(state.adminClientCalls).toBe(0);
    expect(state.fetchCalls).toEqual([]);
  });

  it('404s a well-formed name PocketBase does not have', async () => {
    const res = await one.GET(req(), ctx('pb_backup_nope.zip'));
    expect(res.status).toBe(404);
    expect(state.fetchCalls).toEqual([]);
  });

  it('502s when PocketBase will not send it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gone', { status: 400 })));
    const res = await one.GET(req(), ctx('@auto_pb_backup_ember_20260926040000.zip'));
    expect(res.status).toBe(502);
  });
});

describe('GET /api/admin/backups/member-files', () => {
  it('streams a .tar.gz of the member files', async () => {
    const res = await files.GET(req(), undefined as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/gzip');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="ember-files-\d{4}-\d{2}-\d{2}\.tar\.gz"$/);
    const tar = zlib.gunzipSync(Buffer.from(await res.arrayBuffer()));
    expect(tar.includes(Buffer.from('ember-files/uploads/song.mp3'))).toBe(true);
    expect(tar.includes(Buffer.from('audio-bytes'))).toBe(true);
    expect(tar.includes(Buffer.from('cached.m4a'))).toBe(false);
  });
});
