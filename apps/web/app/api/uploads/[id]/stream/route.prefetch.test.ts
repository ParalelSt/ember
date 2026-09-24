// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

// An upload fetched by the auto cache (`?prefetch=1`) shares the stream
// route's per-listener limit (lib/prefetch), and is marked private.

const musicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-prefetch-'));
process.env.MUSIC_DIR = musicDir;

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, requireUser: async () => ({ user: { id: 'u1' } }) };
});
vi.mock('@/lib/pocketbase/server', () => ({
  createAdminClient: async () => ({ collection: () => ({ getOne: async (id: string) => ({ id, filename: `${id}.wav` }) }) }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { GET } = await import('./route');
const { UPLOAD_DIR } = await import('@/lib/uploads');

let seq = 0;
function get(prefetch: boolean, cookie: string) {
  const url = `http://t/api/uploads/rec1/stream${prefetch ? '?prefetch=1' : ''}`;
  return GET(new NextRequest(url, { headers: { cookie } }), { params: Promise.resolve({ id: 'rec1' }) } as never);
}

beforeEach(() => {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, 'rec1.wav'), 'RIFF-UPLOAD');
});
afterAll(() => fs.rmSync(musicDir, { recursive: true, force: true }));

describe('GET /api/uploads/[id]/stream?prefetch=1', () => {
  it('serves the file marked private, no-store', async () => {
    const res = await get(true, `pb_auth=u-${++seq}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.text()).toBe('RIFF-UPLOAD');
  });

  it('the 11th prefetch in a minute is 429, while a normal play still works', async () => {
    const cookie = `pb_auth=u-${++seq}`;
    for (let i = 0; i < 10; i++) expect((await get(true, cookie)).status).toBe(200);
    const limited = await get(true, cookie);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    const play = await get(false, cookie);
    expect(play.status).toBe(200);
    expect(play.headers.get('cache-control')).toBeNull();
  });
});
