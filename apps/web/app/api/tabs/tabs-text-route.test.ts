// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { UnauthorizedError } from '@/lib/auth';
import { fakePocketBase, type FakePb } from '@/test-utils/fakePocketBase';

// POST /api/tabs/text (a pasted text tab) against the one store, with a
// fake admin client: what is stored, sharing, delete, validation and caps.
// MUSIC_DIR is read when lib/tabs loads, so set it before any import of it.
const musicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabs-text-route-test-'));
process.env.MUSIC_DIR = musicDir;

const requireUser = vi.fn();
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, requireUser: () => requireUser() };
});

let store: FakePb;
vi.mock('@/lib/pocketbase/server', () => ({ createAdminClient: async () => store.pb }));
vi.mock('@/lib/songsterr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/songsterr')>();
  return { ...actual, searchSongsterr: async () => [] };
});

const text = await import('./text/route');
const files = await import('./files/route');
const one = await import('./files/[id]/route');
const download = await import('./files/[id]/download/route');
const { TAB_DIR } = await import('@/lib/tabs');
const { resetBackfill } = await import('@/lib/tabStore');
const { MAX_TAB_TEXT_BYTES } = await import('@/lib/tabText');

// Each test pastes as fresh members: the upload rate limit is per member
// and lives in memory for the whole file.
let n = 0;
const member = (name: string, isAdmin = false) => ({ id: `${name}${++n}`, email: `${name}@x`, isAdmin });
let ALICE = member('alice');
let BOB = member('bob');
const as = (u: { id: string; email: string; isAdmin: boolean } | null) =>
  u ? requireUser.mockResolvedValue({ user: u }) : requireUser.mockRejectedValue(new UnauthorizedError());

const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`http://t${url}`, init);
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const post = (body: unknown) =>
  text.POST(req('/api/tabs/text', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), undefined as never);

const RIFF = [
  'Tempo 100',
  'e|-----------------|',
  'B|-----------------|',
  'G|-----------------|',
  'D|---------2---4---|',
  'A|-----0---2-------|',
  'E|-3---------------|',
].join('\n');

beforeEach(() => {
  store = fakePocketBase({ tabs: [], uploads: [], tracks: [], users: [] });
  resetBackfill();
  requireUser.mockReset();
  ALICE = member('alice');
  BOB = member('bob');
  fs.rmSync(musicDir, { recursive: true, force: true });
});

afterAll(() => fs.rmSync(musicDir, { recursive: true, force: true }));

describe('POST /api/tabs/text', () => {
  it('stores <stem>.alphatex and the paste as <stem>.txt, and a shared pasted row', async () => {
    as(ALICE);
    const res = await post({ text: RIFF, title: 'Copper Sky', artist: 'Coastline', trackId: 'upload:u1' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tab).toMatchObject({ kind: 'pasted', format: 'alphatex', ext: '.alphatex', shared: true, mine: true, canDelete: true, trackId: 'upload:u1' });
    expect(body.report).toMatchObject({ strings: 6, tuningName: 'Standard', bars: 1, notes: 5, tempo: 100 });

    const row = store.rows.get('tabs')![0];
    expect(row).toMatchObject({
      user: ALICE.id,
      kind: 'pasted',
      format: 'alphatex',
      shared: true,
      instrument: 'Guitar',
      song_key: 'copper sky::coastline',
      track_key: 'upload:u1',
    });
    const file = String(row.file);
    expect(file).toMatch(/^[0-9a-f]+\.alphatex$/);
    const tex = fs.readFileSync(path.join(TAB_DIR, file), 'utf8');
    expect(tex).toContain('\\title "Copper Sky"');
    expect(tex).toContain('\\tempo 100');
    expect(fs.readFileSync(path.join(TAB_DIR, file.replace('.alphatex', '.txt')), 'utf8')).toBe(RIFF);
  });

  it('the tempo and tuning sent win over the text', async () => {
    as(ALICE);
    const res = await post({ text: RIFF, title: 'x', tempo: 72, tuning: 'E4 B3 G3 D3 A2 D2' });
    const { report } = await res.json();
    expect(report).toMatchObject({ tempo: 72, tempoSource: 'given', tuningName: 'Drop D' });
    const file = String(store.rows.get('tabs')![0].file);
    expect(fs.readFileSync(path.join(TAB_DIR, file), 'utf8')).toContain('\\tuning (E4 B3 G3 D3 A2 D2)');
  });

  it('another member sees it in the chain, after files and before generated, and can download the alphaTex', async () => {
    as(ALICE);
    const id = (await (await post({ text: RIFF, title: 'Copper Sky', artist: 'Coastline', trackId: 'upload:u1' })).json()).tab.id;
    store.rows.get('tabs')!.push(
      { id: 'g', collectionId: 'tabs', collectionName: 'tabs', created: '2030-01-01', user: '', shared: true, kind: 'generated',
        file: 'upload-u1.alphatex', title: 'Copper Sky', artist: 'Coastline', song_key: 'copper sky::coastline', track_key: 'upload:u1' },
      { id: 'f', collectionId: 'tabs', collectionName: 'tabs', created: '2020-01-01', user: 'x', shared: true, kind: 'file',
        file: 'f.gp5', title: 'Copper Sky', artist: 'Coastline', song_key: 'copper sky::coastline', track_key: 'upload:u1' },
    );
    as(BOB);
    const { tabs } = await (await files.GET(req('/api/tabs/files?kind=all&trackId=upload%3Au1&title=Copper%20Sky&artist=Coastline'), undefined as never)).json();
    expect(tabs.map((t: { kind: string }) => t.kind)).toEqual(['file', 'pasted', 'generated']);
    expect(tabs[1]).toMatchObject({ id, mine: false, canDelete: false, downloadUrl: `/api/tabs/files/${id}/download` });

    const dl = await download.GET(req(`/api/tabs/files/${id}/download`), idCtx(id));
    expect(dl.status).toBe(200);
    expect(await dl.text()).toContain('\\tuning (E4 B3 G3 D3 A2 E2)');

    // The default listing is Guitar Pro and MusicXML files only.
    const plain = await (await files.GET(req('/api/tabs/files?title=Copper%20Sky&artist=Coastline'), undefined as never)).json();
    expect(plain.tabs.map((t: { kind: string }) => t.kind)).toEqual(['file']);
  });

  it('delete: not someone else (403), the paster can, and both files go', async () => {
    as(ALICE);
    const id = (await (await post({ text: RIFF, title: 'Riff' })).json()).tab.id;
    const file = String(store.rows.get('tabs')![0].file);
    const tex = path.join(TAB_DIR, file);
    const txt = path.join(TAB_DIR, file.replace('.alphatex', '.txt'));

    as(BOB);
    expect((await one.DELETE(req(`/api/tabs/files/${id}`, { method: 'DELETE' }), idCtx(id))).status).toBe(403);
    expect(fs.existsSync(tex) && fs.existsSync(txt)).toBe(true);

    as(ALICE);
    expect((await one.DELETE(req(`/api/tabs/files/${id}`, { method: 'DELETE' }), idCtx(id))).status).toBe(200);
    expect(store.rows.get('tabs')).toHaveLength(0);
    expect(fs.existsSync(tex)).toBe(false);
    expect(fs.existsSync(txt)).toBe(false);
  });

  it('an admin can delete a pasted tab; the paster shares its sync nudge', async () => {
    as(ALICE);
    const id = (await (await post({ text: RIFF, title: 'Riff' })).json()).tab.id;
    const patch = await one.PATCH(req(`/api/tabs/files/${id}`, { method: 'PATCH', body: JSON.stringify({ offsetMs: 1500 }) }), idCtx(id));
    expect((await patch.json()).tab.offsetMs).toBe(1500);
    as(member('root', true));
    expect((await one.DELETE(req(`/api/tabs/files/${id}`, { method: 'DELETE' }), idCtx(id))).status).toBe(200);
  });

  it('401 without a user, and nothing is written', async () => {
    as(null);
    expect((await post({ text: RIFF })).status).toBe(401);
    expect(store.rows.get('tabs')).toHaveLength(0);
    expect(fs.existsSync(TAB_DIR) ? fs.readdirSync(TAB_DIR) : []).toEqual([]);
  });

  it('400 for no text, bad JSON, a bad tempo or tuning', async () => {
    as(ALICE);
    expect((await post({ title: 'x' })).status).toBe(400);
    expect((await post({ text: '   ' })).status).toBe(400);
    expect((await post('{not json')).status).toBe(400);
    expect((await post({ text: RIFF, tempo: 'fast' })).status).toBe(400);
    expect((await post({ text: RIFF, tempo: 5 })).status).toBe(400);
    expect((await post({ text: RIFF, tuning: 42 })).status).toBe(400);
    expect(store.rows.get('tabs')).toHaveLength(0);
  });

  it('422 with the report for text that is not a tab, and nothing is written', async () => {
    as(ALICE);
    const res = await post({ text: 'just lyrics\nC G Am F' });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/No tab lines/);
    expect(body.report.skipped).toHaveLength(2);
    expect(store.rows.get('tabs')).toHaveLength(0);
    expect(fs.existsSync(TAB_DIR) ? fs.readdirSync(TAB_DIR) : []).toEqual([]);
  });

  it('413 over 256 KB of text', async () => {
    as(ALICE);
    const big = `${RIFF}\n${'x'.repeat(MAX_TAB_TEXT_BYTES)}`;
    expect((await post({ text: big })).status).toBe(413);
    expect(store.rows.get('tabs')).toHaveLength(0);
  });

  it('shares the tab upload rate limit: 40 an hour', async () => {
    as(ALICE);
    for (let i = 0; i < 40; i++) expect((await post({ text: RIFF, title: `r${i}` })).status).toBe(201);
    expect((await post({ text: RIFF, title: 'one too many' })).status).toBe(429);
  });
});
