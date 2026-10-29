// @vitest-environment node
/** An upload's stream (each Range request of a play) and cover (every row
 *  of a list of uploads) read its row on every request. Each one signed in
 *  to PocketBase as admin, a password check, first: a list of 200 uploads
 *  cost 200 of them. One reused login now serves them all. */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

const musicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-logins-'));
process.env.MUSIC_DIR = musicDir;
process.env.POCKETBASE_ADMIN_EMAIL = 'admin@example.test';
process.env.POCKETBASE_ADMIN_PASSWORD = 'secret';

const pb = vi.hoisted(() => ({ logins: 0 }));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [] }) }));
vi.mock('pocketbase', () => ({
  default: class {
    authStore = {
      token: '',
      save(token: string) {
        this.token = token;
      },
    };
    collection(name: string) {
      return {
        authWithPassword: async () => {
          pb.logins += 1;
          this.authStore.save(`token-${pb.logins}`);
        },
        getOne: async (id: string) => {
          if (name !== 'uploads') throw Object.assign(new Error('not found'), { status: 404 });
          return { id, filename: `${id}.mp3`, artwork_ext: 'png' };
        },
      };
    }
  },
}));
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, requireUser: async () => ({ user: { id: 'u1', email: 'a@b.c', isAdmin: false } }) };
});
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_route: string, handler: unknown) => handler }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const { GET: STREAM } = await import('./stream/route');
const { GET: ART } = await import('./art/route');
const { UPLOAD_DIR } = await import('@/lib/uploads');
const { coverFilename } = await import('@/lib/uploads/cover');

const IDS = Array.from({ length: 10 }, (_, i) => `rec${i}`);

beforeEach(() => {
  pb.logins = 0;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  for (const id of IDS) {
    fs.writeFileSync(path.join(UPLOAD_DIR, `${id}.mp3`), `MP3-${id}`);
    fs.writeFileSync(path.join(UPLOAD_DIR, coverFilename(id, 'png')), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  }
});
afterAll(() => fs.rmSync(musicDir, { recursive: true, force: true }));

describe('upload stream and cover requests', () => {
  it('share one admin login', async () => {
    for (const id of IDS) {
      const ctx = { params: Promise.resolve({ id }) } as never;
      expect((await ART(new NextRequest(`http://t/api/uploads/${id}/art`), ctx)).status).toBe(200);
      const res = await STREAM(new NextRequest(`http://t/api/uploads/${id}/stream`, { headers: { range: 'bytes=0-2' } }), ctx);
      expect(res.status).toBe(206);
    }
    expect(pb.logins).toBeLessThanOrEqual(1);
  });
});
