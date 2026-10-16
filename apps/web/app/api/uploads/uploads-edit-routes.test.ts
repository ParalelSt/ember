// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fakePocketBase, type FakePb } from '@/test-utils/fakePocketBase';

// MUSIC_DIR is read when lib/uploads loads, so set it before the routes load.
const musicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-edit-test-'));
process.env.MUSIC_DIR = musicDir;

const requireUser = vi.fn();
let store: FakePb;

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, requireUser: () => requireUser() };
});
vi.mock('@/lib/pocketbase/server', () => ({ createAdminClient: async () => store.pb }));
vi.mock('@/lib/rateLimit', () => ({ rateLimitResponse: () => null }));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_route: string, handler: unknown) => handler }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const { UnauthorizedError } = await import('@/lib/auth');
const mine = await import('./mine/route');
const item = await import('./[id]/route');
const cover = await import('./[id]/cover/route');
const { UPLOAD_DIR } = await import('@/lib/uploads');

const OWNER = { id: 'owner1', email: 'o@x', isAdmin: false };
const OTHER = { id: 'other1', email: 'x@x', isAdmin: false };
const ADMIN = { id: 'admin1', email: 'a@x', isAdmin: true };

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);

const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const as = (user: object | null) =>
  requireUser.mockImplementation(async () => {
    if (!user) throw new UnauthorizedError();
    return { user };
  });

function patch(id: string, body: unknown) {
  return item.PATCH(
    new Request(`http://t/api/uploads/${id}`, { method: 'PATCH', body: JSON.stringify(body) }) as never,
    ctx(id),
  );
}

function postCover(id: string, file: File | null) {
  const fd = new FormData();
  if (file) fd.append('file', file);
  return cover.POST(new Request(`http://t/api/uploads/${id}/cover`, { method: 'POST', body: fd }) as never, ctx(id));
}

beforeEach(() => {
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  as(OWNER);
  store = fakePocketBase({
    uploads: [
      { id: 'up1', uploader: 'owner1', title: 'Night Drive', artist: 'Me', album: '', filename: 'a.mp3', size_bytes: 8_400_000, created: '2026-10-12 10:00:00.000Z' },
      { id: 'up2', uploader: 'owner1', title: 'Tape 01', artist: '', album: '', filename: 'b.mp3', size_bytes: 5_100_000, created: '2026-09-28 10:00:00.000Z', artwork_ext: 'jpg' },
      { id: 'up3', uploader: 'other1', title: 'Theirs', artist: 'Them', album: '', filename: 'c.mp3', size_bytes: 1, created: '2026-10-13 10:00:00.000Z' },
    ],
    tracks: [{ id: 't1', external_id: 'upload:up1', title: 'Night Drive', artist: 'Me', album: '', artwork_url: '' }],
  });
});

afterAll(() => fs.rmSync(musicDir, { recursive: true, force: true }));

describe('GET /api/uploads/mine', () => {
  it('lists only your own uploads, newest first, with size and added date', async () => {
    const res = await mine.GET(new Request('http://t/api/uploads/mine') as never, undefined as never);
    expect(res.status).toBe(200);
    const { uploads } = await res.json();
    expect(uploads.map((u: { sourceId: string }) => u.sourceId)).toEqual(['up1', 'up2']);
    expect(uploads[0]).toMatchObject({ id: 'upload:up1', title: 'Night Drive', sizeBytes: 8_400_000, created: '2026-10-12 10:00:00.000Z' });
    expect(uploads[1].artworkUrl).toBe('/api/uploads/up2/art');
  });

  it('gives an admin their own uploads too, not everyone else\'s', async () => {
    as(ADMIN);
    const { uploads } = await (await mine.GET(new Request('http://t') as never, undefined as never)).json();
    expect(uploads).toEqual([]);
  });

  it('is 401 signed out', async () => {
    as(null);
    expect((await mine.GET(new Request('http://t') as never, undefined as never)).status).toBe(401);
  });
});

describe('PATCH /api/uploads/[id]', () => {
  it('edits title, artist and album of your own upload, trimmed', async () => {
    const res = await patch('up1', { title: '  Night Drive (demo) ', artist: 'Aron', album: 'Demos' });
    expect(res.status).toBe(200);
    const { upload } = await res.json();
    expect(upload).toMatchObject({ title: 'Night Drive (demo)', artist: 'Aron', album: 'Demos', sizeBytes: 8_400_000 });
    const row = store.rows.get('uploads')!.find((r) => r.id === 'up1')!;
    expect(row).toMatchObject({ title: 'Night Drive (demo)', artist: 'Aron', album: 'Demos', filename: 'a.mp3' });
  });

  it('carries the new details to the song\'s catalog row, so playlists show them', async () => {
    await patch('up1', { title: 'Renamed' });
    expect(store.rows.get('tracks')![0]).toMatchObject({ title: 'Renamed', artist: 'Me' });
  });

  it('refuses someone else\'s upload with 403 and changes nothing', async () => {
    as(OTHER);
    const res = await patch('up1', { title: 'Hijacked' });
    expect(res.status).toBe(403);
    expect(store.rows.get('uploads')!.find((r) => r.id === 'up1')!.title).toBe('Night Drive');
    expect(store.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('lets an admin edit anyone\'s upload', async () => {
    as(ADMIN);
    const res = await patch('up3', { artist: 'Fixed' });
    expect(res.status).toBe(200);
    expect(store.rows.get('uploads')!.find((r) => r.id === 'up3')!.artist).toBe('Fixed');
  });

  it('is 404 for an upload that does not exist', async () => {
    expect((await patch('nope', { title: 'x' })).status).toBe(404);
  });

  it('is 401 signed out', async () => {
    as(null);
    expect((await patch('up1', { title: 'x' })).status).toBe(401);
  });

  it('refuses an empty title, a non-text field and a body that is not an object', async () => {
    expect((await patch('up1', { title: '   ' })).status).toBe(400);
    expect((await patch('up1', { artist: 5 })).status).toBe(400);
    expect((await patch('up1', ['title'])).status).toBe(400);
    expect(store.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('never touches the file: only title, artist and album are written', async () => {
    await patch('up1', { title: 'T', filename: '../../etc/passwd', uploader: 'other1', size_bytes: 1 });
    const update = store.calls.find((c) => c.op === 'update' && c.collection === 'uploads');
    expect(Object.keys((update!.arg as { patch: object }).patch)).toEqual(['title']);
  });

  it('cuts text at 200 characters', async () => {
    await patch('up1', { album: 'a'.repeat(500) });
    expect(String(store.rows.get('uploads')!.find((r) => r.id === 'up1')!.album)).toHaveLength(200);
  });
});

describe('POST /api/uploads/[id]/cover', () => {
  it('stores a JPEG beside the audio as <id>.jpg and gives the cover a new URL', async () => {
    const res = await postCover('up1', new File([JPEG], 'c.jpg', { type: 'image/jpeg' }));
    expect(res.status).toBe(200);
    const { upload } = await res.json();
    expect(fs.readFileSync(path.join(UPLOAD_DIR, 'up1.jpg')).equals(JPEG)).toBe(true);
    expect(upload.artworkUrl).toBe('/api/uploads/up1/art?v=1');
    expect(store.rows.get('tracks')![0].artwork_url).toBe('/api/uploads/up1/art?v=1');
  });

  it('replaces a JPEG cover with a PNG and removes the old file', async () => {
    fs.writeFileSync(path.join(UPLOAD_DIR, 'up2.jpg'), JPEG);
    const res = await postCover('up2', new File([PNG], 'c.png', { type: 'image/png' }));
    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(UPLOAD_DIR, 'up2.jpg'))).toBe(false);
    expect(fs.existsSync(path.join(UPLOAD_DIR, 'up2.png'))).toBe(true);
    expect(store.rows.get('uploads')!.find((r) => r.id === 'up2')).toMatchObject({ artwork_ext: 'png', artwork_v: 1 });
  });

  it('checks the bytes, not the claimed type: a GIF or text is a 415', async () => {
    const gif = Buffer.from('GIF89a......');
    expect((await postCover('up1', new File([gif], 'c.jpg', { type: 'image/jpeg' }))).status).toBe(415);
    expect((await postCover('up1', new File(['hello'], 'c.png', { type: 'image/png' }))).status).toBe(415);
    expect(fs.readdirSync(UPLOAD_DIR)).toEqual([]);
  });

  it('refuses an image over 5 MB with 413', async () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]);
    expect((await postCover('up1', new File([big], 'c.jpg', { type: 'image/jpeg' }))).status).toBe(413);
  });

  it('is 400 without a file', async () => {
    expect((await postCover('up1', null)).status).toBe(400);
  });

  it('refuses someone else\'s upload with 403 and writes nothing', async () => {
    as(OTHER);
    expect((await postCover('up1', new File([JPEG], 'c.jpg', { type: 'image/jpeg' }))).status).toBe(403);
    expect(fs.readdirSync(UPLOAD_DIR)).toEqual([]);
  });

  it('lets an admin set the cover of anyone\'s upload', async () => {
    as(ADMIN);
    expect((await postCover('up3', new File([PNG], 'c.png', { type: 'image/png' }))).status).toBe(200);
  });
});

describe('DELETE /api/uploads/[id]/cover', () => {
  const del = (id: string) => cover.DELETE(new Request('http://t', { method: 'DELETE' }) as never, ctx(id));

  it('removes the file and clears the record, so the song shows no cover', async () => {
    fs.writeFileSync(path.join(UPLOAD_DIR, 'up2.jpg'), JPEG);
    const res = await del('up2');
    expect(res.status).toBe(200);
    expect((await res.json()).upload.artworkUrl).toBeNull();
    expect(fs.existsSync(path.join(UPLOAD_DIR, 'up2.jpg'))).toBe(false);
    expect(store.rows.get('uploads')!.find((r) => r.id === 'up2')!.artwork_ext).toBe('');
  });

  it('refuses someone else\'s upload with 403 and keeps the file', async () => {
    fs.writeFileSync(path.join(UPLOAD_DIR, 'up2.jpg'), JPEG);
    as(OTHER);
    expect((await del('up2')).status).toBe(403);
    expect(fs.existsSync(path.join(UPLOAD_DIR, 'up2.jpg'))).toBe(true);
  });

  it('is 401 signed out', async () => {
    as(null);
    expect((await del('up2')).status).toBe(401);
  });
});
