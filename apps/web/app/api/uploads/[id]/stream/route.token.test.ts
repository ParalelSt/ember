// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

// An upload's audio and cover, asked for by a cast device with a signed link
// (lib/streamToken) and no cookie. The link opens exactly the upload and the
// use it names, nothing else.

const musicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-token-'));
process.env.MUSIC_DIR = musicDir;
process.env.STREAM_TOKEN_SECRET = 'u'.repeat(48);

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, requireUser: async () => { throw new actual.UnauthorizedError(); } };
});
vi.mock('@/lib/pocketbase/server', () => ({
  createAdminClient: async () => ({
    collection: () => ({ getOne: async (id: string) => ({ id, filename: `${id}.mp3`, artwork_ext: 'png' }) }),
  }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_route: string, handler: unknown) => handler }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const { GET: STREAM } = await import('./route');
const { GET: ART } = await import('../art/route');
const { UPLOAD_DIR } = await import('@/lib/uploads');
const { coverFilename } = await import('@/lib/uploads/cover');
const { signStreamToken, _resetStreamTokenSecret } = await import('@/lib/streamToken');

const sign = (trackId: string, scope: 'stream' | 'art', nowMs?: number) =>
  encodeURIComponent(signStreamToken({ trackId, userId: 'caster', scope, nowMs }).token);
const stream = (id: string, q = '') =>
  STREAM(new NextRequest(`http://t/api/uploads/${id}/stream${q}`), { params: Promise.resolve({ id }) } as never);
const art = (id: string, q = '') =>
  ART(new NextRequest(`http://t/api/uploads/${id}/art${q}`), { params: Promise.resolve({ id }) } as never);

beforeEach(() => {
  _resetStreamTokenSecret();
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  for (const id of ['rec1', 'rec2']) {
    fs.writeFileSync(path.join(UPLOAD_DIR, `${id}.mp3`), `MP3-${id}`);
    fs.writeFileSync(path.join(UPLOAD_DIR, coverFilename(id, 'png')), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  }
});
afterAll(() => fs.rmSync(musicDir, { recursive: true, force: true }));

describe('upload routes: signed cast links', () => {
  it('no cookie and no link is 401 (as before)', async () => {
    expect((await stream('rec1')).status).toBe(401);
    expect((await art('rec1')).status).toBe(401);
  });

  it('a stream link plays that upload', async () => {
    const res = await stream('rec1', `?st=${sign('upload:rec1', 'stream')}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('MP3-rec1');
  });

  it('an art link shows that cover', async () => {
    const res = await art('rec1', `?st=${sign('upload:rec1', 'art')}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('a link for another upload is 401', async () => {
    expect((await stream('rec2', `?st=${sign('upload:rec1', 'stream')}`)).status).toBe(401);
    expect((await art('rec2', `?st=${sign('upload:rec1', 'art')}`)).status).toBe(401);
  });

  it('a stream link does not open the cover route, nor an art link the audio', async () => {
    expect((await art('rec1', `?st=${sign('upload:rec1', 'stream')}`)).status).toBe(401);
    expect((await stream('rec1', `?st=${sign('upload:rec1', 'art')}`)).status).toBe(401);
  });

  it('a YouTube link is 401 here', async () => {
    expect((await stream('rec1', `?st=${sign('youtube:dQw4w9WgXcQ', 'stream')}`)).status).toBe(401);
  });

  it('an expired link is 401', async () => {
    const old = Date.now() - 6 * 3600_000 - 1000;
    expect((await stream('rec1', `?st=${sign('upload:rec1', 'stream', old)}`)).status).toBe(401);
  });

  it('a tampered link is 401', async () => {
    const t = decodeURIComponent(sign('upload:rec1', 'stream'));
    expect((await stream('rec1', `?st=${encodeURIComponent(t.slice(0, -3) + 'AAA')}`)).status).toBe(401);
  });
});
