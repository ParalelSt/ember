// @vitest-environment node
import { afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

// An upload whose record exists but whose file is gone from the host's disk
// is the host's data bug: the player only sees a 404, and withRequestLog does
// not log a 404, so it was reported nowhere. The route logs it at error.

const musicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-missing-'));
process.env.MUSIC_DIR = musicDir;

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, requireUser: async () => ({ user: { id: 'u1' } }) };
});
vi.mock('@/lib/pocketbase/server', () => ({
  createCatalogClient: async () => ({ collection: () => ({ getOne: async (id: string) => ({ id, filename: `${id}.wav` }) }) }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));
vi.mock('@/lib/logger/server', () => ({
  serverLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const { GET } = await import('./route');
const { serverLogger } = await import('@/lib/logger/server');

afterAll(() => fs.rmSync(musicDir, { recursive: true, force: true }));

describe('GET /api/uploads/[id]/stream, the file gone from disk', () => {
  it('answers 404 and logs it at error, naming the upload', async () => {
    const res = await GET(new NextRequest('http://t/api/uploads/gone1/stream'), { params: Promise.resolve({ id: 'gone1' }) } as never);
    expect(res.status).toBe(404);
    expect(serverLogger.error).toHaveBeenCalledWith('uploads', 'upload file missing on disk', expect.objectContaining({ id: 'gone1', filename: 'gone1.wav' }));
  });
});
