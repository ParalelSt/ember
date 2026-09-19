// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakePocketBase, type FakePb } from '@/test-utils/fakePocketBase';
import { findTabs, mapTab, songKeyOf } from '@/lib/tabStore';
import { pickerLabel, sourceChipLabel } from '@/lib/tabSources';
import { PoliteFetcher } from './polite';
import { findOnline as findOnlineAll, MAX_TAB_PAGES, resetOnline } from './online';
import { readJsStore } from './ug';

const FIXTURES = path.resolve(__dirname, '../../../../tests/fixtures/ug');
const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const SONG = { title: 'Harbour Lights', artist: 'The Lantern Keepers', trackId: 'youtube:abc123' };
const KEY = songKeyOf(SONG);
const VIEWER = { id: 'alice', isAdmin: false };

/** These tests are Ultimate Guitar's; Songsterr has its own file
 *  (songsterrOnline.test.ts). */
const findOnline = (...[pb, song, opts]: Parameters<typeof findOnlineAll>) => findOnlineAll(pb, song, { sites: ['ug'], ...opts });

/** A site that serves the fixtures and records every URL asked for.
 *  `search` overrides the search page; `status` answers every request
 *  with that status instead. */
function site(opts: { search?: string; status?: number } = {}) {
  const urls: string[] = [];
  let now = 5_000_000;
  const fetchFn = (async (url: string) => {
    urls.push(url);
    if (opts.status) return new Response('slow down', { status: opts.status });
    if (url.includes('/search.php')) return new Response(opts.search ?? fixture('search.html'));
    const id = /-(\d+)$/.exec(new URL(url).pathname)?.[1];
    const file = id && path.join(FIXTURES, `tab-${id}.html`);
    if (file && fs.existsSync(file)) return new Response(fs.readFileSync(file, 'utf8'));
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  const fetcher = new PoliteFetcher({
    fetch: fetchFn,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  return { fetcher, urls, advance: (ms: number) => (now += ms) };
}

/** A search page with the results changed. */
function searchWith(change: (results: Record<string, unknown>[]) => void): string {
  const html = fixture('search.html');
  const store = readJsStore(html) as { store: { page: { data: { results: Record<string, unknown>[] } } } };
  change(store.store.page.data.results);
  const attr = JSON.stringify(store).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return html.replace(/data-content="[^"]*"/, `data-content="${attr}"`);
}

let fake: FakePb;
let dir: string;
beforeEach(() => {
  resetOnline();
  fake = fakePocketBase({ tabs: [], tab_lookups: [] });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-fetched-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const tabs = () => fake.rows.get('tabs') ?? [];
const lookups = () => fake.rows.get('tab_lookups') ?? [];

describe('finding a tab online, once per song', () => {
  it('searches once, fetches the best guitar and bass tab, stores rows and files', async () => {
    const s = site();
    const res = await findOnline(fake.pb, SONG, { fetcher: s.fetcher, dir, base: 'https://www.ultimate-guitar.com' });
    expect(res).toMatchObject({ status: 'found', added: 2 });
    // One search, then MAX_TAB_PAGES pages.
    expect(s.urls).toHaveLength(1 + MAX_TAB_PAGES);
    expect(s.urls[0]).toContain('/search.php?search_type=title&value=The%20Lantern%20Keepers%20Harbour%20Lights');
    expect(s.urls.slice(1)).toEqual([
      'https://tabs.ultimate-guitar.com/tab/the-lantern-keepers/harbour-lights-tabs-9100001',
      'https://tabs.ultimate-guitar.com/tab/the-lantern-keepers/harbour-lights-bass-9100011',
    ]);

    const [guitar, bass] = tabs();
    expect(guitar).toMatchObject({
      kind: 'fetched',
      format: 'alphatex',
      shared: true,
      song_key: KEY,
      track_key: 'youtube:abc123',
      instrument: 'Guitar',
      title: 'Harbour Lights',
      artist: 'The Lantern Keepers',
      source_site: 'ug',
      source_url: 'https://tabs.ultimate-guitar.com/tab/the-lantern-keepers/harbour-lights-tabs-9100001',
      source_id: '9100001',
      source_rating: 4.71,
      source_votes: 512,
    });
    expect(guitar.user).toBeUndefined();
    expect(guitar.source_meta).toMatchObject({
      part: 'guitar',
      version: 1,
      tuning: { name: 'Drop D', value: 'D A D G B E' },
      report: { tuningName: 'Drop D', bars: 40, tempo: 100, tempoSource: 'text' },
    });
    expect(bass).toMatchObject({ instrument: 'Bass', source_id: '9100011', source_votes: 140 });

    // On disk: the alphaTex and the tab text beside it.
    const tex = path.join(dir, String(guitar.file));
    expect(fs.readFileSync(tex, 'utf8')).toContain('\\tempo 100');
    expect(fs.readFileSync(tex.replace(/\.alphatex$/, '.txt'), 'utf8')).toContain('D|-0---3---5---3---|');

    expect(lookups()).toHaveLength(1);
    expect(lookups()[0]).toMatchObject({ song_key: KEY, site: 'ug', status: 'found', query: 'The Lantern Keepers Harbour Lights' });
    expect((lookups()[0].results as { id: number }[]).map((x) => x.id)).toEqual([9100001, 9100002, 9100004, 9100003, 9100011, 9100012]);
  });

  it('never searches the same song again on its own', async () => {
    const s = site();
    await findOnline(fake.pb, SONG, { fetcher: s.fetcher, dir });
    const again = await findOnline(fake.pb, { ...SONG, title: 'Harbour Lights (Remastered)', trackId: 'upload:x' }, { fetcher: s.fetcher, dir });
    expect(again).toMatchObject({ status: 'cached', added: 0 });
    expect(again.searchedAt).toBeTruthy();
    expect(s.urls).toHaveLength(3);
    expect(tabs()).toHaveLength(2);
  });

  it('two people opening the song at once share one search', async () => {
    const s = site();
    const [a, b] = await Promise.all([
      findOnline(fake.pb, SONG, { fetcher: s.fetcher, dir }),
      findOnline(fake.pb, SONG, { fetcher: s.fetcher, dir }),
    ]);
    expect(a).toEqual(b);
    expect(s.urls).toHaveLength(3);
    expect(tabs()).toHaveLength(2);
  });

  it('"Search online again" searches, and fetches nothing it already has', async () => {
    const s = site();
    await findOnline(fake.pb, SONG, { fetcher: s.fetcher, dir });
    const first = lookups()[0].searched_at;
    s.advance(60_000);
    const res = await findOnline(fake.pb, SONG, { fetcher: s.fetcher, dir, again: true, now: () => new Date('2030-01-01T00:00:00Z') });
    expect(res).toMatchObject({ status: 'found', added: 0 });
    expect(s.urls).toHaveLength(4);
    expect(s.urls[3]).toContain('/search.php');
    expect(tabs()).toHaveLength(2);
    expect(lookups()).toHaveLength(1);
    expect(lookups()[0].searched_at).not.toBe(first);
  });

  it('"Search online again" tries a new leader; a page gone missing is skipped', async () => {
    const s = site();
    await findOnline(fake.pb, SONG, { fetcher: s.fetcher, dir });
    const later = site({
      search: searchWith((results) => {
        // 9100004 now leads the guitar list, but its page is gone (404).
        Object.assign(results.find((x) => x.id === 9100004)!, { rating: 4.95, votes: 9000 });
      }),
    });
    const res = await findOnline(fake.pb, SONG, { fetcher: later.fetcher, dir, again: true });
    // The search, the new leader's page, then 9100001 is already stored.
    expect(later.urls.map((u) => u.replace(/.*[-/]/, ''))).toEqual([expect.stringContaining('search.php'), '9100004']);
    expect(res).toMatchObject({ status: 'found', added: 0 });
    expect(tabs()).toHaveLength(2);
  });

  it('remembers a song with nothing online as "none", and does not ask again', async () => {
    const s = site({ search: fixture('search-empty.html') });
    const res = await findOnline(fake.pb, SONG, { fetcher: s.fetcher, dir });
    expect(res).toMatchObject({ status: 'none', added: 0 });
    expect(lookups()[0]).toMatchObject({ status: 'none' });
    expect(tabs()).toHaveLength(0);
    expect((await findOnline(fake.pb, SONG, { fetcher: s.fetcher, dir })).status).toBe('cached');
    expect(s.urls).toHaveLength(1);
  });

  it('a page with no notes spends its turn; the next candidate gets the other', async () => {
    const s = site({
      search: searchWith((results) => {
        // The chord-names-only page leads the guitar list.
        Object.assign(results.find((x) => x.id === 9100003)!, { votes: 9000, rating: 4.9 });
      }),
    });
    const res = await findOnline(fake.pb, SONG, { fetcher: s.fetcher, dir });
    expect(s.urls.slice(1).map((u) => u.replace(/.*-/, ''))).toEqual(['9100003', '9100001']);
    expect(res).toMatchObject({ status: 'found', added: 1 });
    expect(tabs().map((t) => t.source_id)).toEqual(['9100001']);
  });

  for (const status of [429, 403]) {
    it(`a ${status} is quiet: nothing recorded, no request for an hour, then it tries again`, async () => {
      const s = site({ status });
      expect(await findOnline(fake.pb, SONG, { fetcher: s.fetcher, dir })).toMatchObject({ status: 'failed', added: 0 });
      expect(lookups()).toHaveLength(0);
      expect(await findOnline(fake.pb, SONG, { fetcher: s.fetcher, dir })).toMatchObject({ status: 'failed' });
      expect(s.urls).toHaveLength(1);
      s.advance(61 * 60 * 1000);
      await findOnline(fake.pb, SONG, { fetcher: s.fetcher, dir });
      expect(s.urls).toHaveLength(2);
    });
  }

  it('a block page served as a 200 is not "nothing found": it backs off', async () => {
    const s = site({ search: '<html><body>Please verify you are a human</body></html>' });
    expect(await findOnline(fake.pb, SONG, { fetcher: s.fetcher, dir })).toMatchObject({ status: 'failed' });
    expect(lookups()).toHaveLength(0);
    expect(s.fetcher.backoffUntil('ug')).not.toBeNull();
  });

  it('writes through a fresh admin client each time when given one', async () => {
    const s = site();
    let asked = 0;
    const res = await findOnline(fake.pb, SONG, {
      fetcher: s.fetcher,
      dir,
      freshPb: async () => {
        asked += 1;
        return fake.pb;
      },
    });
    expect(res.added).toBe(2);
    // Two tab rows and the lookup.
    expect(asked).toBe(3);
  });

  it('a song with no title is not searched', async () => {
    const s = site();
    expect(await findOnline(fake.pb, { ...SONG, title: '  ' }, { fetcher: s.fetcher, dir })).toMatchObject({ status: 'none' });
    expect(s.urls).toHaveLength(0);
  });
});

describe('fetched rows in the store', () => {
  it('list after pasted, before generated, with their source and labels', async () => {
    const s = site();
    await findOnline(fake.pb, SONG, { fetcher: s.fetcher, dir });
    fake.rows.get('tabs')!.push(
      { id: 'gen1', kind: 'generated', title: 'Harbour Lights', artist: 'The Lantern Keepers', song_key: KEY, shared: true, file: 'g.alphatex', created: '2026-09-19 10:00:00' } as never,
      { id: 'pas1', kind: 'pasted', title: 'Harbour Lights', artist: 'The Lantern Keepers', song_key: KEY, shared: true, user: 'bob', file: 'p.alphatex', created: '2026-09-01 10:00:00' } as never,
    );
    // The bass row is the newer one; the guitar tab still leads.
    fake.rows.get('tabs')!.find((r) => r.source_id === '9100011')!.created = '2030-01-01 00:00:00';
    const rows = await findTabs(fake.pb, VIEWER, { title: SONG.title, artist: SONG.artist });
    expect(rows.map((r) => r.kind)).toEqual(['pasted', 'fetched', 'fetched', 'generated']);
    expect(rows.filter((r) => r.kind === 'fetched').map((r) => r.source_id)).toEqual(['9100001', '9100011']);

    const guitar = mapTab(rows.find((r) => r.source_id === '9100001')!, VIEWER);
    expect(guitar.kind).toBe('fetched');
    expect(guitar.canDelete).toBe(false);
    expect(guitar.downloadUrl).toBe(`/api/tabs/files/${guitar.id}/download`);
    expect(guitar.source).toEqual({
      site: 'ug',
      siteLabel: 'Ultimate Guitar',
      url: 'https://tabs.ultimate-guitar.com/tab/the-lantern-keepers/harbour-lights-tabs-9100001',
      part: 'guitar',
      version: 1,
      rating: 4.71,
      votes: 512,
    });
    expect(sourceChipLabel(guitar)).toBe('From Ultimate Guitar, not lined up yet');
    expect(pickerLabel(guitar)).toBe('Ultimate Guitar, Text tab, ★ 4.7 (512 votes)');
    const bass = mapTab(rows.find((r) => r.source_id === '9100011')!, VIEWER);
    expect(sourceChipLabel(bass)).toBe('From Ultimate Guitar, bass, not lined up yet');
    expect(pickerLabel(bass)).toBe('Ultimate Guitar, Bass tab, ★ 4.6 (140 votes)');
  });

  it('the files list (kind file) leaves fetched tabs out', async () => {
    const s = site();
    await findOnline(fake.pb, SONG, { fetcher: s.fetcher, dir });
    expect(await findTabs(fake.pb, VIEWER, { title: SONG.title, artist: SONG.artist }, { kind: 'file' })).toEqual([]);
    expect(await findTabs(fake.pb, VIEWER, { title: SONG.title, artist: SONG.artist }, { kind: 'fetched' })).toHaveLength(2);
  });
});
