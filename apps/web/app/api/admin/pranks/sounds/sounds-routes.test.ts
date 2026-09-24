// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { fakePocketBase, type FakePb } from '@/test-utils/fakePocketBase';
import { pbDate } from '@/lib/pranks/limits';

// The prank library (upload, list, rename, delete) and the media route that
// serves it, against a fake admin client and a throwaway MUSIC_DIR.

const who = vi.hoisted(() => ({ id: 'root' as string | null, admin: true, limited: false }));
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  const requireUser = async () => {
    if (!who.id) throw new actual.UnauthorizedError();
    return { pb: store.pb, user: { id: who.id, email: `${who.id}@x`, isAdmin: who.admin } };
  };
  const requireAdmin = async () => {
    const ctx = await requireUser();
    if (!ctx.user.isAdmin) throw new actual.ForbiddenError();
    return ctx;
  };
  return { ...actual, requireUser, requireAdmin };
});
vi.mock('@/lib/rateLimit', () => ({
  rateLimitResponse: () => (who.limited ? Response.json({ error: 'Slow down' }, { status: 429 }) : null),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_n: string, h: unknown) => h }));

let store: FakePb;
vi.mock('@/lib/pocketbase/server', () => ({ createAdminClient: async () => store.pb }));

const musicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prank-lib-'));
process.env.MUSIC_DIR = musicDir;
const prankDir = path.join(musicDir, 'pranks');

const sounds = await import('./route');
const one = await import('./[id]/route');
const media = await import('@/app/api/pranks/media/[id]/route');

afterAll(() => {
  fs.rmSync(musicDir, { recursive: true, force: true });
  delete process.env.MUSIC_DIR;
});

/** A mono 16-bit PCM WAV of `seconds` of a quiet tone. */
function wav(seconds: number, rate = 8000): Buffer {
  const data = Buffer.alloc(Math.round(seconds * rate) * 2);
  for (let i = 0; i < data.length / 2; i++) data.writeInt16LE(Math.round(2000 * Math.sin(i / 3)), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200)]);

const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`http://t${url}`, init);
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

function upload(bytes: Buffer, fields: Record<string, string>, filename = 'quack.wav', type = 'audio/wav') {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(bytes)], filename, { type }));
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return sounds.POST(req('/api/admin/pranks/sounds', { method: 'POST', body: form }), undefined as never);
}
const filesOnDisk = () => (fs.existsSync(prankDir) ? fs.readdirSync(prankDir) : []);
const libRows = () => store.rows.get('prank_sounds') ?? [];

function seedFile(id: string, kind: 'sound' | 'song', seconds = 2) {
  fs.mkdirSync(prankDir, { recursive: true });
  const filename = `${id}0000000000000000.wav`;
  fs.writeFileSync(path.join(prankDir, filename), wav(seconds));
  store.rows.get('prank_sounds')!.push({
    id, collectionId: 'prank_sounds', collectionName: 'prank_sounds', kind, name: `${id} name`, filename,
    mime: 'audio/wav', duration_sec: seconds, size_bytes: 1, created: pbDate(Date.now()),
  } as never);
}

beforeEach(() => {
  who.id = 'root';
  who.admin = true;
  who.limited = false;
  fs.rmSync(prankDir, { recursive: true, force: true });
  store = fakePocketBase({
    prank_sounds: [],
    prank_schedules: [],
    pranks: [],
    app_settings: [{ id: 's1', key: 'pranks', value: { enabled: true } }],
  });
});

describe('POST /api/admin/pranks/sounds', () => {
  it('stores a short sound under MUSIC_DIR/pranks with a random name and its measured length', async () => {
    const res = await upload(wav(3), { kind: 'sound', name: '  Duck quack  ' });
    expect(res.status).toBe(201);
    const { sound } = await res.json();
    expect(sound).toMatchObject({ kind: 'sound', name: 'Duck quack', mime: 'audio/wav' });
    expect(sound.durationSec).toBeCloseTo(3, 0);
    expect(sound.url).toBe(`/api/pranks/media/${sound.id}`);
    const [row] = libRows();
    expect(row).toMatchObject({ kind: 'sound', uploaded_by: 'root' });
    expect(String(row.filename)).toMatch(/^[0-9a-f]{24}\.wav$/);
    expect(filesOnDisk()).toEqual([row.filename]);
    expect(fs.existsSync(path.join(musicDir, 'uploads'))).toBe(false);
  });

  it('names it after the file when no name is given', async () => {
    const { sound } = await (await upload(wav(1), { kind: 'sound' }, 'Air horn.wav')).json();
    expect(sound.name).toBe('Air horn');
  });

  it('sniffs the bytes: a png renamed to mp3 is refused and nothing is written', async () => {
    const res = await upload(PNG, { kind: 'sound' }, 'quack.mp3', 'audio/mpeg');
    expect(res.status).toBe(415);
    expect((await res.json()).error).toBe('That does not look like an audio file');
    expect(filesOnDisk()).toEqual([]);
    expect(libRows()).toHaveLength(0);
  });

  it('refuses a claimed type it does not accept, even with audio bytes', async () => {
    expect((await upload(wav(1), { kind: 'sound' }, 'x.wav', 'video/mp4')).status).toBe(415);
  });

  it('caps sounds at 30 s', async () => {
    const res = await upload(wav(31), { kind: 'sound' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Sounds are 30 seconds at most; trim it and try again');
    expect(filesOnDisk()).toEqual([]);
    const song = await upload(wav(31), { kind: 'song' });
    expect(song.status).toBe(201);
    expect((await song.json()).sound.kind).toBe('song');
  });

  it('caps sounds at 5 MB and songs at 50 MB', async () => {
    const big = Buffer.concat([wav(1), Buffer.alloc(5 * 1024 * 1024)]);
    const res = await upload(big, { kind: 'sound' });
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe('Sounds are 5 MB at most');
    const huge = Buffer.concat([wav(1), Buffer.alloc(50 * 1024 * 1024)]);
    expect((await upload(huge, { kind: 'song' })).status).toBe(413);
    expect(filesOnDisk()).toEqual([]);
  });

  it('needs a kind, a file, and an admin', async () => {
    expect((await upload(wav(1), { kind: 'jingle' })).status).toBe(400);
    expect((await upload(Buffer.alloc(0), { kind: 'sound' })).status).toBe(400);
    who.admin = false;
    expect((await upload(wav(1), { kind: 'sound' })).status).toBe(403);
    who.id = null;
    expect((await upload(wav(1), { kind: 'sound' })).status).toBe(401);
    expect(libRows()).toHaveLength(0);
  });

  it('answers 429 when the upload limiter says so', async () => {
    who.limited = true;
    expect((await upload(wav(1), { kind: 'sound' })).status).toBe(429);
  });
});

describe('library list, rename, delete', () => {
  it('lists every file for admins only', async () => {
    seedFile('snd1', 'sound');
    seedFile('sng1', 'song', 40);
    const body = await (await sounds.GET(req('/api/admin/pranks/sounds'), undefined as never)).json();
    expect(body.sounds.map((s: { id: string; kind: string }) => `${s.id}:${s.kind}`).sort()).toEqual(['snd1:sound', 'sng1:song']);
    expect(JSON.stringify(body)).not.toContain('.wav');
    who.admin = false;
    expect((await sounds.GET(req('/api/admin/pranks/sounds'), undefined as never)).status).toBe(403);
  });

  it('renames, and refuses an empty name or a missing file', async () => {
    seedFile('snd1', 'sound');
    const rename = (id: string, name: unknown) =>
      one.PATCH(req(`/api/admin/pranks/sounds/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }), idCtx(id));
    const res = await rename('snd1', ' Moo ');
    expect(res.status).toBe(200);
    expect((await res.json()).sound.name).toBe('Moo');
    expect((await rename('snd1', '   ')).status).toBe(400);
    expect((await rename('nope', 'Moo')).status).toBe(404);
  });

  it('deletes the record and the file', async () => {
    seedFile('snd1', 'sound');
    const file = String(libRows()[0].filename);
    const res = await one.DELETE(req('/api/admin/pranks/sounds/snd1', { method: 'DELETE' }), idCtx('snd1'));
    expect(res.status).toBe(200);
    expect(libRows()).toHaveLength(0);
    expect(fs.existsSync(path.join(prankDir, file))).toBe(false);
  });

  it('refuses to delete while an active schedule still plays it', async () => {
    seedFile('snd1', 'sound');
    store.rows.get('prank_schedules')!.push({ id: 'sch1', sound: 'snd1', active: true } as never);
    const res = await one.DELETE(req('/api/admin/pranks/sounds/snd1', { method: 'DELETE' }), idCtx('snd1'));
    expect(res.status).toBe(409);
    expect(libRows()).toHaveLength(1);
    // A stopped schedule does not hold it.
    store.rows.get('prank_schedules')![0].active = false;
    expect((await one.DELETE(req('/api/admin/pranks/sounds/snd1', { method: 'DELETE' }), idCtx('snd1'))).status).toBe(200);
  });

  it('delete is admin only', async () => {
    seedFile('snd1', 'sound');
    who.admin = false;
    expect((await one.DELETE(req('/api/admin/pranks/sounds/snd1', { method: 'DELETE' }), idCtx('snd1'))).status).toBe(403);
    expect(libRows()).toHaveLength(1);
  });
});

describe('GET /api/pranks/media/[id]', () => {
  const get = (id: string, headers: Record<string, string> = {}) =>
    media.GET(req(`/api/pranks/media/${id}`, { headers }), idCtx(id));
  const prank = (over: Record<string, unknown>) => {
    const now = Date.now();
    store.rows.get('pranks')!.push({
      id: `p${store.rows.get('pranks')!.length}`, target: 'marko', sound: 'snd1', kind: 'sound', status: 'pending',
      created: pbDate(now - 2000), expires_at: pbDate(now + 40_000), ...over,
    } as never);
  };
  const asMarko = () => {
    who.id = 'marko';
    who.admin = false;
  };

  it('always serves an admin (preview), not cached', async () => {
    seedFile('snd1', 'sound');
    const res = await get('snd1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/wav');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString()).toBe('RIFF');
  });

  it('answers a Range request with 206', async () => {
    seedFile('snd1', 'sound');
    const res = await get('snd1', { range: 'bytes=0-99' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toMatch(/^bytes 0-99\/\d+$/);
    expect((await res.arrayBuffer()).byteLength).toBe(100);
    expect((await get('snd1', { range: 'bytes=999999999-' })).status).toBe(416);
  });

  it('is 403 for a member with no prank carrying the file', async () => {
    seedFile('snd1', 'sound');
    asMarko();
    expect((await get('snd1')).status).toBe(403);
    // Someone else's prank does not open it for marko.
    prank({ target: 'ivana' });
    expect((await get('snd1')).status).toBe(403);
    // Nor does a prank carrying a different file.
    prank({ sound: 'snd2' });
    expect((await get('snd1')).status).toBe(403);
  });

  it('is 200 for the target while the prank is live (pending in its window, or delivered and recent)', async () => {
    seedFile('snd1', 'sound');
    asMarko();
    prank({});
    expect((await get('snd1')).status).toBe(200);
    store.rows.get('pranks')![0].status = 'delivered';
    expect((await get('snd1', { range: 'bytes=0-9' })).status).toBe(206);
  });

  it('closes once the prank is over, expired, or old', async () => {
    seedFile('snd1', 'sound');
    asMarko();
    const now = Date.now();
    prank({ status: 'done' });
    prank({ status: 'pending', created: pbDate(now - 60_000), expires_at: pbDate(now - 15_000) });
    prank({ status: 'delivered', created: pbDate(now - 60 * 60 * 1000) });
    prank({ status: 'skipped' });
    prank({ status: 'cancelled' });
    expect((await get('snd1')).status).toBe(403);
  });

  it('is 403 for everyone but admins while the switch is off', async () => {
    seedFile('snd1', 'sound');
    prank({});
    store.rows.get('app_settings')![0].value = { enabled: false };
    asMarko();
    expect((await get('snd1')).status).toBe(403);
    who.id = 'root';
    who.admin = true;
    expect((await get('snd1')).status).toBe(200);
  });

  it('401 signed out, 404 for a missing file', async () => {
    who.id = null;
    expect((await get('snd1')).status).toBe(401);
    who.id = 'root';
    expect((await get('nothing')).status).toBe(404);
    seedFile('snd1', 'sound');
    fs.rmSync(prankDir, { recursive: true, force: true });
    expect((await get('snd1')).status).toBe(404);
  });
});
