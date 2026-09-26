// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import type { RecordModel } from 'pocketbase';
import { fakePocketBase, type FakePb } from '@/test-utils/fakePocketBase';
import { findTabs, mapTab, songKeyOf } from '@/lib/tabStore';
import { pickerLabel, sourceChipLabel } from '@/lib/tabSources';
import { PoliteFetcher } from './polite';
import { findOnline, resetOnline, staleNone } from './online';

/** Songsterr found online against a site that
 *  serves tests/fixtures/songsterr (Songsterr's shapes, invented content)
 *  and, for the both-sites checks, tests/fixtures/ug. */
const SS = path.resolve(__dirname, '../../../../tests/fixtures/songsterr');
const UG = path.resolve(__dirname, '../../../../tests/fixtures/ug');
const read = (dir: string, name: string) => fs.readFileSync(path.join(dir, name), 'utf8');
const SONG = { title: 'Copper Tide', artist: 'Night Ferry', trackId: 'youtube:ss12345' };
const KEY = songKeyOf(SONG);
const VIEWER = { id: 'alice', isAdmin: false };
const BASE = 'https://ss.test';
const CDN = 'https://cdn.test';

interface SiteOpts {
  status?: Record<string, number>;
  page?: string;
  search?: string;
}

/** Answers Songsterr's search, song page and CDN parts; `status` maps a
 *  URL part ("api/songs", "tab-s777001", "/3.json") to a status. */
function site(opts: SiteOpts = {}) {
  const urls: string[] = [];
  let now = 5_000_000;
  const fetchFn = (async (url: string) => {
    urls.push(url);
    for (const [part, status] of Object.entries(opts.status ?? {})) {
      if (url.includes(part)) return new Response('nope', { status });
    }
    if (url.startsWith(`${BASE}/api/songs`)) return new Response(opts.search ?? read(SS, 'search.json'));
    if (url.startsWith(`${BASE}/a/wsa/`) && url.endsWith('-tab-s777001')) return new Response(opts.page ?? read(SS, 'song.html'));
    const part = new RegExp(`^${CDN}/777001/5550001/v0-fixture-Ab12Cd34/(\\d+)\\.json$`).exec(url);
    if (part && fs.existsSync(path.join(SS, `part-${part[1]}.json`))) return new Response(read(SS, `part-${part[1]}.json`));
    if (url.includes('/search.php')) return new Response(read(UG, 'search-empty.html'));
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  const fetcher = new PoliteFetcher({ fetch: fetchFn, now: () => now, sleep: async (ms) => void (now += ms) });
  return { fetcher, urls, advance: (ms: number) => (now += ms) };
}

let fake: FakePb;
let dir: string;
beforeEach(() => {
  resetOnline();
  fake = fakePocketBase({ tabs: [], tab_lookups: [] });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-songsterr-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const tabs = () => fake.rows.get('tabs') ?? [];
const lookups = () => fake.rows.get('tab_lookups') ?? [];
const deps = (s: ReturnType<typeof site>, more = {}) => ({
  fetcher: s.fetcher,
  dir,
  songsterrBase: BASE,
  songsterrCdn: CDN,
  base: 'https://ug.test',
  sites: ['songsterr' as const],
  ...more,
});

describe('Songsterr, once per song', () => {
  it('searches, reads the song page, fetches the guitar and bass parts, stores one multi-track tab', async () => {
    const s = site();
    const added: RecordModel[] = [];
    const res = await findOnline(fake.pb, SONG, deps(s, { onAdded: (rows: RecordModel[]) => added.push(...rows) }));
    expect(res).toMatchObject({ status: 'found', added: 1 });
    expect(s.urls).toEqual([
      `${BASE}/api/songs?pattern=Night%20Ferry%20Copper%20Tide`,
      `${BASE}/a/wsa/night-ferry-copper-tide-tab-s777001`,
      `${CDN}/777001/5550001/v0-fixture-Ab12Cd34/2.json`,
      `${CDN}/777001/5550001/v0-fixture-Ab12Cd34/1.json`,
      `${CDN}/777001/5550001/v0-fixture-Ab12Cd34/3.json`,
    ]);
    // Two queues: Songsterr itself, and its CDN.
    expect(s.fetcher.sent.get('songsterr')).toBe(2);
    expect(s.fetcher.sent.get('songsterr-cdn')).toBe(3);

    const [row] = tabs();
    expect(row).toMatchObject({
      kind: 'fetched',
      format: 'alphatex',
      shared: true,
      song_key: KEY,
      track_key: 'youtube:ss12345',
      title: 'Copper Tide',
      artist: 'Night Ferry',
      source_site: 'songsterr',
      source_url: 'https://www.songsterr.com/a/wsa/night-ferry-copper-tide-tab-s777001',
      source_id: '777001',
    });
    expect(row.user).toBeUndefined();
    expect(row.source_meta).toMatchObject({
      part: 'multi',
      revisionId: 5550001,
      instruments: ['Rhythm Guitar', 'Lead Guitar', 'Bass'],
      report: { bars: 18, anacrusis: true, tempo: 100 },
    });
    expect(added.map((r) => r.id)).toEqual([row.id]);

    // On disk: the alphaTex (read by AlphaTab: three staves) and the parts.
    const tex = fs.readFileSync(path.join(dir, String(row.file)), 'utf8');
    const imp = new alphaTab.importer.AlphaTexImporter();
    imp.initFromString(tex, new alphaTab.Settings());
    expect(imp.readScore().tracks.map((t) => t.name)).toEqual(['Rhythm Guitar', 'Lead Guitar', 'Bass']);
    const raw = JSON.parse(fs.readFileSync(path.join(dir, String(row.file).replace(/\.alphatex$/, '.json')), 'utf8'));
    expect(raw).toMatchObject({ songId: 777001, revisionId: 5550001, image: 'v0-fixture-Ab12Cd34' });
    expect(raw.parts.map((p: { partId: number }) => p.partId)).toEqual([2, 1, 3]);

    expect(lookups()).toHaveLength(1);
    expect(lookups()[0]).toMatchObject({ song_key: KEY, site: 'songsterr', status: 'found', query: 'Night Ferry Copper Tide' });
    // The song itself, then its bracketed variant; another band's song is not it.
    expect((lookups()[0].results as { songId: number }[]).map((x) => x.songId)).toEqual([777001, 777002]);
  });

  it('never asks again on its own; "Search online again" searches but does not refetch what it has', async () => {
    const s = site();
    await findOnline(fake.pb, SONG, deps(s));
    expect(await findOnline(fake.pb, SONG, deps(s))).toMatchObject({ status: 'cached', added: 0 });
    expect(s.urls).toHaveLength(5);
    s.advance(60_000);
    expect(await findOnline(fake.pb, SONG, deps(s, { again: true }))).toMatchObject({ status: 'found', added: 0 });
    expect(s.urls).toHaveLength(6);
    expect(s.urls[5]).toContain('/api/songs');
    expect(tabs()).toHaveLength(1);
  });

  it('searches Songsterr first, then Ultimate Guitar, and lists Songsterr’s tab first', async () => {
    const s = site();
    const res = await findOnline(fake.pb, SONG, deps(s, { sites: undefined }));
    expect(res).toMatchObject({ status: 'found', added: 1 });
    expect(s.urls[0]).toContain(`${BASE}/api/songs`);
    expect(s.urls[5]).toContain('https://ug.test/search.php');
    expect(lookups().map((l) => [l.site, l.status])).toEqual([
      ['songsterr', 'found'],
      ['ug', 'none'],
    ]);
    // Both remembered: the next opening asks nobody.
    expect(await findOnline(fake.pb, SONG, deps(s, { sites: undefined }))).toMatchObject({ status: 'cached' });
    expect(s.urls).toHaveLength(6);

    fake.rows.get('tabs')!.push({ id: 'ug1', kind: 'fetched', source_site: 'ug', title: SONG.title, artist: SONG.artist, song_key: KEY, shared: true, file: 'u.alphatex', source_votes: 900, created: '2030-01-01 00:00:00' } as never);
    const rows = await findTabs(fake.pb, VIEWER, { title: SONG.title, artist: SONG.artist });
    expect(rows.map((r) => r.source_site)).toEqual(['songsterr', 'ug']);
  });

  it('a song Songsterr lacks is "none" after one request', async () => {
    const s = site({ search: JSON.stringify(JSON.parse(read(SS, 'search.json')).slice(2)) });
    expect(await findOnline(fake.pb, SONG, deps(s))).toMatchObject({ status: 'none', added: 0 });
    expect(s.urls).toHaveLength(1);
    expect(lookups()[0]).toMatchObject({ site: 'songsterr', status: 'none' });
  });

  it('a restricted tab is left alone: no part is fetched', async () => {
    const page = read(SS, 'song.html').replace('"isRestricted":false', '"isRestricted":true');
    const s = site({ page });
    expect(await findOnline(fake.pb, SONG, deps(s))).toMatchObject({ status: 'none', added: 0 });
    expect(s.urls).toHaveLength(2);
    expect(tabs()).toHaveLength(0);
  });

  it('a missing part is skipped; the others make the tab', async () => {
    const s = site({ status: { '/1.json': 404 } });
    expect(await findOnline(fake.pb, SONG, deps(s))).toMatchObject({ status: 'found', added: 1 });
    expect(tabs()[0].source_meta).toMatchObject({ instruments: ['Rhythm Guitar', 'Bass'] });
  });

  it('a 429 is quiet: nothing recorded, the site left alone for an hour, Ultimate Guitar still asked', async () => {
    const s = site({ status: { 'api/songs': 429 } });
    // One site failing makes the whole search "failed" (the page says it
    // could not search just now), whatever the other found.
    expect(await findOnline(fake.pb, SONG, deps(s, { sites: undefined }))).toMatchObject({ status: 'failed', added: 0 });
    expect(lookups().map((l) => l.site)).toEqual(['ug']);
    expect(s.fetcher.backoffUntil('songsterr')).not.toBeNull();
    // The next opening asks Songsterr nothing while it waits; UG is cached.
    expect(await findOnline(fake.pb, SONG, deps(s, { sites: undefined }))).toMatchObject({ status: 'failed' });
    expect(s.urls.filter((u) => u.startsWith(BASE))).toHaveLength(1);
    s.advance(61 * 60 * 1000);
    await findOnline(fake.pb, SONG, deps(s, { sites: undefined }));
    expect(s.urls.filter((u) => u.startsWith(BASE))).toHaveLength(2);
  });

  it('a page without its state (a block page) backs off, nothing recorded', async () => {
    const s = site({ page: '<html><body>Just a moment...</body></html>' });
    expect(await findOnline(fake.pb, SONG, deps(s))).toMatchObject({ status: 'failed' });
    expect(lookups()).toHaveLength(0);
    expect(s.fetcher.backoffUntil('songsterr')).not.toBeNull();
  });

  it('a search that is not JSON backs off too', async () => {
    const s = site({ search: '<html>captcha</html>' });
    expect(await findOnline(fake.pb, SONG, deps(s))).toMatchObject({ status: 'failed' });
    expect(s.fetcher.backoffUntil('songsterr')).not.toBeNull();
  });
});

describe('a Songsterr row on the page', () => {
  it('says Songsterr, the instrument shown, and whether it is lined up', async () => {
    const s = site();
    await findOnline(fake.pb, SONG, deps(s));
    const row = tabs()[0];
    const tab = mapTab(row, VIEWER);
    expect(tab.source).toEqual({
      site: 'songsterr',
      siteLabel: 'Songsterr',
      url: 'https://www.songsterr.com/a/wsa/night-ferry-copper-tide-tab-s777001',
      part: 'multi',
      instruments: ['Rhythm Guitar', 'Lead Guitar', 'Bass'],
      version: 1,
      rating: null,
      votes: null,
    });
    expect(tab.timing).toBeNull();
    expect(sourceChipLabel(tab, 'Rhythm Guitar')).toBe('From Songsterr, Rhythm Guitar, not lined up yet');
    expect(pickerLabel(tab)).toBe('Songsterr, Tab with rhythm, 3 instruments');

    row.timing = { offset_ms: 1350, bpm: 97, confidence: 0.82, bars: [{ bar: 0, ms: 1350 }] };
    expect(sourceChipLabel(mapTab(row, VIEWER), 'Bass')).toBe('From Songsterr, Bass, lined up');
    row.timing = { offset_ms: 1350, bpm: 97, confidence: 0.2, bars: [] };
    expect(sourceChipLabel(mapTab(row, VIEWER))).toBe('From Songsterr, not lined up yet');
  });
});

describe('a song with a Japanese title (tests/fixtures/songsterr-yomi)', () => {
  // Songsterr's real answers for the song (metadata only), with the
  // invented parts of tests/fixtures/songsterr standing in for its notes.
  const YOMI = path.resolve(__dirname, '../../../../tests/fixtures/songsterr-yomi');
  const JP = { title: '黄泉より聴こゆ、皇国の燈と焔の少女', artist: 'Imperial Circus Dead Decadence', trackId: 'youtube:yomi12345ab' };
  const PARTS: Record<string, string> = { '0': 'part-1.json', '1': 'part-2.json', '3': 'part-1.json', '5': 'part-3.json' };

  function yomiSite() {
    const urls: string[] = [];
    let now = 9_000_000;
    const fetchFn = (async (url: string) => {
      urls.push(url);
      if (url.startsWith(`${BASE}/api/songs`)) return new Response(read(YOMI, 'search.json'));
      if (url.startsWith(`${BASE}/a/wsa/`) && url.endsWith('-tab-s460015')) return new Response(read(YOMI, 'song.html'));
      const m = new RegExp(`^${CDN}/460015/7547158/v0-3-2-oSEG8HeSIhlC305k/(\\d+)\\.json$`).exec(url);
      if (m && PARTS[m[1]]) return new Response(read(SS, PARTS[m[1]]));
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;
    const fetcher = new PoliteFetcher({ fetch: fetchFn, now: () => now, sleep: async (ms) => void (now += ms) });
    return { fetcher, urls };
  }

  it('imports it: the search matches the title, and the tab is stored and drawable', async () => {
    const s = yomiSite();
    const res = await findOnline(fake.pb, JP, deps(s as never));
    expect(res).toMatchObject({ status: 'found', added: 1 });
    // The query is the title as it is, percent-encoded once.
    expect(s.urls[0]).toBe(`${BASE}/api/songs?pattern=${encodeURIComponent('Imperial Circus Dead Decadence 黄泉より聴こゆ、皇国の燈と焔の少女')}`);
    expect(s.urls[1]).toMatch(/-tab-s460015$/);
    expect(s.urls.slice(2).map((u) => u.split('/').pop())).toEqual(['0.json', '1.json', '3.json', '5.json']);

    const [row] = tabs();
    expect(row).toMatchObject({ source_site: 'songsterr', source_id: '460015', song_key: songKeyOf(JP), title: JP.title });
    const tex = fs.readFileSync(path.join(dir, String(row.file)), 'utf8');
    const imp = new alphaTab.importer.AlphaTexImporter();
    imp.initFromString(tex, new alphaTab.Settings());
    expect(imp.readScore().tracks).toHaveLength(4);
    expect(lookups()[0]).toMatchObject({ site: 'songsterr', status: 'found' });
    // And the page finds it by the song.
    const rows = await findTabs(fake.pb, VIEWER, { title: JP.title, artist: JP.artist });
    expect(rows.map((r) => r.source_id)).toEqual(['460015']);
  });
});

describe('a "none" recorded before titles in any script could match', () => {
  const old = (query: string, searched_at: string) =>
    ({ id: `l${query.length}`, song_key: '', site: 'songsterr', status: 'none', query, searched_at, results: [] }) as never;

  it('is searched once more for a non-Latin title, not for a Latin one or a fresh answer', () => {
    expect(staleNone(old('Imperial Circus Dead Decadence 黄泉より聴こゆ', '2026-09-20 10:00:00.000Z'))).toBe(true);
    expect(staleNone(old('Кино Группа крови', '2026-09-01T00:00:00.000Z'))).toBe(true);
    expect(staleNone(old('Night Ferry Copper Tide', '2026-09-20 10:00:00.000Z'))).toBe(false);
    expect(staleNone(old('Imperial Circus Dead Decadence 黄泉より聴こゆ', '2026-10-01 10:00:00.000Z'))).toBe(false);
    expect(staleNone({ ...(old('黄泉', '2026-09-01T00:00:00Z') as object), status: 'found' } as never)).toBe(false);
    expect(staleNone(null)).toBe(false);
  });

  it('the song is found on the next opening, without "Search online again"', async () => {
    const JP = { title: '黄泉より聴こゆ、皇国の燈と焔の少女', artist: 'Imperial Circus Dead Decadence', trackId: 'youtube:yomi12345ab' };
    fake.rows.get('tab_lookups')!.push({
      id: 'old1', collectionId: 'tab_lookups', collectionName: 'tab_lookups', created: '',
      song_key: songKeyOf(JP), site: 'songsterr', status: 'none', query: `${JP.artist} ${JP.title}`,
      searched_at: '2026-09-20 10:00:00.000Z', results: [],
    } as never);
    const YOMI = path.resolve(__dirname, '../../../../tests/fixtures/songsterr-yomi');
    const urls: string[] = [];
    const fetchFn = (async (url: string) => {
      urls.push(url);
      if (url.startsWith(`${BASE}/api/songs`)) return new Response(read(YOMI, 'search.json'));
      if (url.endsWith('-tab-s460015')) return new Response(read(YOMI, 'song.html'));
      if (/\/(0|1|3)\.json$/.test(url)) return new Response(read(SS, 'part-1.json'));
      if (/\/5\.json$/.test(url)) return new Response(read(SS, 'part-3.json'));
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;
    let now = 1;
    const fetcher = new PoliteFetcher({ fetch: fetchFn, now: () => now, sleep: async (ms) => void (now += ms) });
    expect(await findOnline(fake.pb, JP, { ...deps({ fetcher } as never) })).toMatchObject({ status: 'found', added: 1 });
    expect(lookups()).toHaveLength(1);
    expect(lookups()[0]).toMatchObject({ id: 'old1', status: 'found' });
    // Now it is a real answer: the next opening asks nobody.
    expect(await findOnline(fake.pb, JP, { ...deps({ fetcher } as never) })).toMatchObject({ status: 'cached' });
  });
});
