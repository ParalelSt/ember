// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { UnauthorizedError } from '@/lib/auth';
import { fakePocketBase, type FakePb } from '@/test-utils/fakePocketBase';

// The tab routes against the one store (lib/tabStore.ts), with a fake admin
// client: sharing, delete permission, the hints cache and generated rows.
// MUSIC_DIR is read when lib/tabs loads, so set it before any import of it.
const musicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabs-routes-test-'));
process.env.MUSIC_DIR = musicDir;

const requireUser = vi.fn();
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, requireUser: () => requireUser() };
});

let store: FakePb;
vi.mock('@/lib/pocketbase/server', () => ({ createAdminClient: async () => store.pb }));

const search = vi.fn();
vi.mock('@/lib/songsterr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/songsterr')>();
  return { ...actual, searchSongsterr: (t: string, a: string) => search(t, a) };
});

// No yt-dlp and no transcriber in a unit test: the job is a promise we own.
const gen = { status: 'none' as string, job: Promise.resolve() };
vi.mock('@/lib/tabGenerate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tabGenerate')>();
  return {
    ...actual,
    generationStatus: () => (gen.status === 'ready' ? { status: 'ready' } : { status: gen.status }),
    startGeneration: () => gen.job,
  };
});
vi.mock('@/lib/sources/youtube', () => ({ ensureDownloaded: async () => '/tmp/audio.m4a' }));

const files = await import('./files/route');
const one = await import('./files/[id]/route');
const download = await import('./files/[id]/download/route');
const songsterr = await import('./route');
const generated = await import('./generated/[trackId]/route');
const { TAB_DIR, GENERATED_DIR } = await import('@/lib/tabs');
const { resetBackfill } = await import('@/lib/tabStore');

const ALICE = { id: 'alice', email: 'a@x', isAdmin: false };
const BOB = { id: 'bob', email: 'b@x', isAdmin: false };
const ADMIN = { id: 'root', email: 'r@x', isAdmin: true };
const as = (u: typeof ALICE | null) =>
  u ? requireUser.mockResolvedValue({ user: u }) : requireUser.mockRejectedValue(new UnauthorizedError());

const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`http://t${url}`, init);
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const trackCtx = (trackId: string) => ({ params: Promise.resolve({ trackId: encodeURIComponent(trackId) }) }) as never;

const GP5 = Buffer.concat([Buffer.from([24]), Buffer.from('FICHIER GUITAR PRO v5.10', 'ascii'), Buffer.alloc(100)]);

function uploadForm(fields: Record<string, string>) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(GP5)]), 'song.gp5');
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return req('/api/tabs/files', { method: 'POST', body: form });
}

beforeEach(() => {
  store = fakePocketBase({ tabs: [], uploads: [], tracks: [], users: [] });
  resetBackfill();
  requireUser.mockReset();
  search.mockReset();
  search.mockResolvedValue([]);
  gen.status = 'none';
  gen.job = Promise.resolve();
  fs.rmSync(musicDir, { recursive: true, force: true });
});

afterAll(() => fs.rmSync(musicDir, { recursive: true, force: true }));

describe('POST /api/tabs/files', () => {
  it('stores the file and a shared row keyed by song', async () => {
    as(ALICE);
    const res = await files.POST(uploadForm({ title: 'Master of Puppets', artist: 'Metallica', trackId: 'youtube:abc' }), undefined as never);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tab).toMatchObject({ kind: 'file', format: 'gp5', shared: true, mine: true, canDelete: true, trackId: 'youtube:abc' });
    const row = store.rows.get('tabs')![0];
    expect(row).toMatchObject({ user: 'alice', shared: true, kind: 'file', song_key: 'master of puppets::::metallica', track_key: 'youtube:abc' });
    expect(fs.existsSync(path.join(TAB_DIR, String(row.file)))).toBe(true);
  });

  it('401 without a user, and nothing is written', async () => {
    as(null);
    const res = await files.POST(uploadForm({ title: 'x' }), undefined as never);
    expect(res.status).toBe(401);
    expect(store.rows.get('tabs')).toHaveLength(0);
  });
});

describe('GET /api/tabs/files', () => {
  it('another member sees a shared tab for the same song, not a private one', async () => {
    as(ALICE);
    await files.POST(uploadForm({ title: 'Master of Puppets', artist: 'Metallica' }), undefined as never);
    store.rows.get('tabs')!.push({
      id: 'private1', collectionId: 'tabs', collectionName: 'tabs', created: '2026-01-01', user: 'alice', shared: false,
      kind: 'file', file: 'p.gp5', title: 'Master of Puppets', artist: 'Metallica', song_key: 'master of puppets::::metallica',
    });

    as(BOB);
    const res = await files.GET(req('/api/tabs/files?title=Master%20of%20Puppets%20(Remastered)&artist=Metallica'), undefined as never);
    const { tabs } = await res.json();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ shared: true, mine: false, canDelete: false });

    as(ALICE);
    const mine = await (await files.GET(req('/api/tabs/files?title=Master%20of%20Puppets&artist=Metallica'), undefined as never)).json();
    expect(mine.tabs).toHaveLength(2);
  });

  it('lists only file tabs (generated ones have their own section)', async () => {
    store.rows.get('tabs')!.push({
      id: 'g', collectionId: 'tabs', collectionName: 'tabs', created: '', user: '', shared: true, kind: 'generated',
      file: 'youtube-abc.alphatex', title: 'One', artist: 'Metallica', song_key: 'one::::metallica', track_key: 'youtube:abc',
    });
    as(BOB);
    const { tabs } = await (await files.GET(req('/api/tabs/files?title=One&artist=Metallica'), undefined as never)).json();
    expect(tabs).toEqual([]);
  });

  it('kind=all is the whole chain for the tab page: files first, then generated, with who added each', async () => {
    store.rows.get('users')!.push({ id: 'alice', collectionId: 'users', collectionName: 'users', name: 'Alice' });
    as(ALICE);
    await files.POST(uploadForm({ title: 'One', artist: 'Metallica', trackId: 'youtube:abc' }), undefined as never);
    store.rows.get('tabs')!.push({
      id: 'g', collectionId: 'tabs', collectionName: 'tabs', created: '2030-01-01', user: '', shared: true, kind: 'generated',
      file: 'youtube-abc.alphatex', title: 'One', artist: 'Metallica', song_key: 'one::::metallica', track_key: 'youtube:abc',
    });
    as(BOB);
    const res = await files.GET(req('/api/tabs/files?kind=all&trackId=youtube%3Aabc&title=One&artist=Metallica'), undefined as never);
    const { tabs } = await res.json();
    expect(tabs.map((t: { kind: string }) => t.kind)).toEqual(['file', 'generated']);
    expect(tabs[0]).toMatchObject({ addedBy: 'Alice', mine: false, shared: true, trackId: 'youtube:abc' });
    expect(tabs[1]).toMatchObject({ addedBy: null, downloadUrl: '/api/tabs/generated/youtube%3Aabc' });
  });

  it('a track id alone finds the tabs added for that track', async () => {
    as(ALICE);
    await files.POST(uploadForm({ title: 'Riff', artist: 'Me', trackId: 'upload:u1' }), undefined as never);
    const { tabs } = await (await files.GET(req('/api/tabs/files?kind=all&trackId=upload%3Au1'), undefined as never)).json();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ title: 'Riff', mine: true, addedBy: null });
  });

  it('401 without a user', async () => {
    as(null);
    expect((await files.GET(req('/api/tabs/files'), undefined as never)).status).toBe(401);
  });
});

describe('PATCH /api/tabs/files/[id] (the shared sync nudge)', () => {
  const patch = (id: string, body: unknown) =>
    one.PATCH(req(`/api/tabs/files/${id}`, { method: 'PATCH', body: JSON.stringify(body) }), idCtx(id));

  async function aliceUploads(): Promise<string> {
    as(ALICE);
    return (await (await files.POST(uploadForm({ title: 'Riff', artist: 'Me' }), undefined as never)).json()).tab.id;
  }

  it('whoever added the tab saves offset_ms for everyone', async () => {
    const id = await aliceUploads();
    const res = await patch(id, { offsetMs: 1234 });
    expect(res.status).toBe(200);
    expect((await res.json()).tab.offsetMs).toBe(1234);
    as(BOB);
    const { tabs } = await (await files.GET(req('/api/tabs/files?title=Riff&artist=Me'), undefined as never)).json();
    expect(tabs[0].offsetMs).toBe(1234);
  });

  it('someone else cannot (403), an admin can', async () => {
    const id = await aliceUploads();
    as(BOB);
    expect((await patch(id, { offsetMs: 500 })).status).toBe(403);
    as(ADMIN);
    expect((await patch(id, { offsetMs: 500 })).status).toBe(200);
  });

  it('only a number within +-30 min (a tab minutes into a live set saves)', async () => {
    const id = await aliceUploads();
    expect((await patch(id, { offsetMs: 'soon' })).status).toBe(400);
    expect((await patch(id, { offsetMs: 2 * 60 * 60 * 1000 })).status).toBe(400);
    expect((await patch(id, {})).status).toBe(400);
    const far = await patch(id, { offsetMs: -185_250 });
    expect(far.status).toBe(200);
    expect((await far.json()).tab.offsetMs).toBe(-185_250);
  });

  it('someone else’s private tab is a 404, and 401 without a user', async () => {
    const id = await aliceUploads();
    store.rows.get('tabs')![0].shared = false;
    as(BOB);
    expect((await patch(id, { offsetMs: 0 })).status).toBe(404);
    as(null);
    expect((await patch(id, { offsetMs: 0 })).status).toBe(401);
  });
});

describe('DELETE /api/tabs/files/[id] and download', () => {
  async function aliceUploads(): Promise<string> {
    as(ALICE);
    const res = await files.POST(uploadForm({ title: 'Riff', artist: 'Me' }), undefined as never);
    return (await res.json()).tab.id;
  }

  it('B can download A’s shared tab but cannot delete it; A can', async () => {
    const id = await aliceUploads();
    const file = path.join(TAB_DIR, String(store.rows.get('tabs')![0].file));

    as(BOB);
    const dl = await download.GET(req(`/api/tabs/files/${id}/download`), idCtx(id));
    expect(dl.status).toBe(200);
    expect(Buffer.from(await dl.arrayBuffer()).equals(GP5)).toBe(true);
    expect((await one.DELETE(req(`/api/tabs/files/${id}`, { method: 'DELETE' }), idCtx(id))).status).toBe(403);
    expect(store.rows.get('tabs')).toHaveLength(1);

    as(ALICE);
    expect((await one.DELETE(req(`/api/tabs/files/${id}`, { method: 'DELETE' }), idCtx(id))).status).toBe(200);
    expect(store.rows.get('tabs')).toHaveLength(0);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('an admin can delete anyone’s tab', async () => {
    const id = await aliceUploads();
    as(ADMIN);
    expect((await one.DELETE(req(`/api/tabs/files/${id}`, { method: 'DELETE' }), idCtx(id))).status).toBe(200);
  });

  it('someone else’s private tab is a 404 for both download and delete', async () => {
    const id = await aliceUploads();
    store.rows.get('tabs')![0].shared = false;
    as(BOB);
    expect((await download.GET(req(`/api/tabs/files/${id}/download`), idCtx(id))).status).toBe(404);
    expect((await one.DELETE(req(`/api/tabs/files/${id}`, { method: 'DELETE' }), idCtx(id))).status).toBe(404);
  });

  it('401 without a user', async () => {
    const id = await aliceUploads();
    as(null);
    expect((await download.GET(req(`/api/tabs/files/${id}/download`), idCtx(id))).status).toBe(401);
    expect((await one.DELETE(req(`/api/tabs/files/${id}`, { method: 'DELETE' }), idCtx(id))).status).toBe(401);
  });

  it('deleting a generated row removes its alphaTex from the generated folder', async () => {
    fs.mkdirSync(GENERATED_DIR, { recursive: true });
    const file = path.join(GENERATED_DIR, 'upload-u1.alphatex');
    fs.writeFileSync(file, '\\title "x"');
    store.rows.get('tabs')!.push({
      id: 'g1', collectionId: 'tabs', collectionName: 'tabs', created: '', user: 'alice', shared: true, kind: 'generated',
      file: 'upload-u1.alphatex', title: 'x', track_key: 'upload:u1',
    });
    as(ALICE);
    expect((await one.DELETE(req('/api/tabs/files/g1', { method: 'DELETE' }), idCtx('g1'))).status).toBe(200);
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe('GET /api/tabs (Songsterr)', () => {
  const SONG = { songId: 42, artist: 'Metallica', title: 'One', hasChords: false, tracks: [{ instrument: 'Guitar', tuning: [64], difficulty: 1 }] };

  it('searches once per song that has a tab, then answers from the stored hints', async () => {
    store.rows.get('tabs')!.push({
      id: 't', collectionId: 'tabs', collectionName: 'tabs', created: '', user: 'alice', shared: true, kind: 'file',
      file: 'a.gp5', title: 'One', artist: 'Metallica', song_key: 'one::::metallica',
    });
    search.mockResolvedValue([SONG]);
    as(BOB);
    const first = await (await songsterr.GET(req('/api/tabs?title=One&artist=Metallica'), undefined as never)).json();
    expect(first.matches).toMatchObject([{ id: 42, instruments: ['Guitar'] }]);
    const second = await (await songsterr.GET(req('/api/tabs?title=One%20(Live)&artist=Metallica'), undefined as never)).json();
    expect(second.matches).toMatchObject([{ id: 42 }]);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('400 without a title, 401 without a user', async () => {
    as(ALICE);
    expect((await songsterr.GET(req('/api/tabs?artist=x'), undefined as never)).status).toBe(400);
    as(null);
    expect((await songsterr.GET(req('/api/tabs?title=x'), undefined as never)).status).toBe(401);
    expect(search).not.toHaveBeenCalled();
  });

  it('Songsterr down is an empty list, never an error', async () => {
    search.mockResolvedValue(null);
    as(ALICE);
    const res = await songsterr.GET(req('/api/tabs?title=One&artist=Metallica'), undefined as never);
    expect(res.status).toBe(200);
    expect((await res.json()).matches).toEqual([]);
  });
});

describe('/api/tabs/generated/[trackId] rows', () => {
  it('records a shared generated row naming who asked when the job finishes', async () => {
    store.rows.get('tracks')!.push({ id: 'tr1', collectionId: 'tracks', collectionName: 'tracks', created: '', external_id: 'youtube:vid1', title: 'One (Official Video)', artist: 'Metallica' });
    let finish!: () => void;
    gen.job = new Promise<void>((r) => (finish = r));
    as(ALICE);
    const res = await generated.POST(req('/api/tabs/generated/youtube%3Avid1?title=One&artist=Metallica', { method: 'POST' }), trackCtx('youtube:vid1'));
    expect(res.status).toBe(202);
    expect(store.rows.get('tabs')).toHaveLength(0);

    finish();
    await vi.waitFor(() => expect(store.rows.get('tabs')).toHaveLength(1));
    expect(store.rows.get('tabs')![0]).toMatchObject({
      kind: 'generated', shared: true, user: 'alice', track_key: 'youtube:vid1', file: 'youtube-vid1.alphatex',
      title: 'One (Official Video)', song_key: 'one::::metallica',
    });
  });

  it('records a row on first GET for a tab generated before the store (disk only)', async () => {
    fs.mkdirSync(GENERATED_DIR, { recursive: true });
    fs.writeFileSync(path.join(GENERATED_DIR, 'upload-up1.alphatex'), '\\title "Old"');
    store.rows.get('uploads')!.push({ id: 'up1', collectionId: 'uploads', collectionName: 'uploads', created: '', title: 'Old Song', artist: 'Band' });
    gen.status = 'ready';
    as(BOB);
    const res = await generated.GET(req('/api/tabs/generated/upload%3Aup1'), trackCtx('upload:up1'));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('\\title');
    expect(store.rows.get('tabs')).toMatchObject([{ kind: 'generated', user: null, song_key: 'old song::::band', track_key: 'upload:up1' }]);
  });

  it('a poll and the job finishing together still write one row', async () => {
    fs.mkdirSync(GENERATED_DIR, { recursive: true });
    fs.writeFileSync(path.join(GENERATED_DIR, 'upload-up2.alphatex'), '\\title "Two"');
    gen.status = 'ready';
    as(BOB);
    await Promise.all([
      generated.GET(req('/api/tabs/generated/upload%3Aup2'), trackCtx('upload:up2')),
      generated.GET(req('/api/tabs/generated/upload%3Aup2'), trackCtx('upload:up2')),
      generated.POST(req('/api/tabs/generated/upload%3Aup2', { method: 'POST' }), trackCtx('upload:up2')),
    ]);
    expect(store.rows.get('tabs')).toHaveLength(1);
  });

  it('401 without a user', async () => {
    as(null);
    expect((await generated.GET(req('/api/tabs/generated/upload%3Aup1'), trackCtx('upload:up1'))).status).toBe(401);
    expect((await generated.POST(req('/api/tabs/generated/upload%3Aup1', { method: 'POST' }), trackCtx('upload:up1'))).status).toBe(401);
  });
});
