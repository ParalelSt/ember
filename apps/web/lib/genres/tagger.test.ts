import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { artistKey, firstArtist } from './artistKey';
import { createRateLimiter } from './rateLimit';
import { lastfmTopTags, musicbrainzTags, musicbrainzUserAgent, pickMbArtist } from './sources';
import { createTagger, FOUND_REFRESH_MS, needsLookup, NONE_RETRY_MS, type ArtistGenre, type GenreStore } from './tagger';
import { fromRecord, pbQuote, toRecord } from './store';

// Saved Last.fm and MusicBrainz answers (tests/fixtures/genres/), in the
// shapes both APIs document. Nothing here reaches the network: fetch is a
// fake that serves the files.
const FIX = path.resolve(__dirname, '../../../../tests/fixtures/genres');
const load = (name: string) => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-10-16T04:00:00Z');

function memoryStore(seed: ArtistGenre[] = []) {
  const rows = new Map(seed.map((r) => [r.key, r]));
  const saves: ArtistGenre[] = [];
  const store: GenreStore = {
    async getMany(keys) {
      return new Map(keys.filter((k) => rows.has(k)).map((k) => [k, rows.get(k)!]));
    },
    async save(row) {
      saves.push(row);
      rows.set(row.key, row);
    },
  };
  return { store, rows, saves };
}

const row = (over: Partial<ArtistGenre> & { key: string }): ArtistGenre => ({
  name: over.key, artistId: null, family: 'pop', families: { pop: 1 }, sub: null, tags: [], source: 'lastfm', status: 'found',
  fetchedAt: new Date(T0 - DAY).toISOString(), ...over,
});

describe('artistKey', () => {
  it('keys on the lead artist, normalized', () => {
    expect(firstArtist('Dua Lipa feat. DaBaby')).toBe('Dua Lipa');
    expect(firstArtist('Tool, Maynard James Keenan')).toBe('Tool');
    expect(firstArtist('Simon & Garfunkel')).toBe('Simon & Garfunkel');
    expect(artistKey('Gojira - Topic')).toBe('gojira');
    expect(artistKey('GOJIRA ft. Someone')).toBe('gojira');
    expect(artistKey('Цеца')).toBe('цеца');
  });
});

describe('lastfmTopTags', () => {
  it('reads the saved top tags, strongest first', async () => {
    const fetchImpl = vi.fn(async (_url: string) => json(load('lastfm-gojira.json')));
    const tags = await lastfmTopTags('Gojira', 'KEY', fetchImpl);
    expect(tags?.[0]).toEqual({ name: 'death metal', count: 100 });
    expect(tags).toHaveLength(8);
    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain('method=artist.gettoptags');
    expect(url).toContain('artist=Gojira');
    expect(url).toContain('api_key=KEY');
  });

  it('answers null for an unknown artist and throws for a fault', async () => {
    expect(await lastfmTopTags('Nobody', 'K', async () => json(load('lastfm-not-found.json')))).toBeNull();
    await expect(lastfmTopTags('X', 'K', async () => json(load('lastfm-rate-limited.json'), 429))).rejects.toThrow(/Rate Limit/);
    await expect(lastfmTopTags('X', 'K', async () => new Response('<html>', { status: 503 }))).rejects.toThrow(/503/);
  });
});

describe('musicbrainzTags', () => {
  it('picks the best same-name hit, then reads its genres (doubled) and tags, pacing both requests', async () => {
    const urls: string[] = [];
    const uas: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(url);
      uas.push(String((init?.headers as Record<string, string>)['User-Agent']));
      return json(url.includes('/artist/?') ? load('musicbrainz-search-tool.json') : load('musicbrainz-artist-tool.json'));
    });
    const pace = vi.fn(async () => {});
    const tags = await musicbrainzTags('Tool', { userAgent: musicbrainzUserAgent('me@example.com'), pace, fetchImpl });
    expect(pace).toHaveBeenCalledTimes(2);
    expect(urls[1]).toContain('/artist/66fc5bf8-daa4-4241-b378-9bc9077939d2?fmt=json&inc=genres+tags');
    expect(uas[0]).toBe('Ember/1.0 ( me@example.com )');
    expect(tags?.[0]).toEqual({ name: 'progressive metal', count: 24 });
  });

  it('answers null when nobody of that name scores high enough', async () => {
    const pace = vi.fn(async () => {});
    expect(await musicbrainzTags('Nobody', { userAgent: 'x', pace, fetchImpl: async () => json(load('musicbrainz-search-empty.json')) })).toBeNull();
    expect(pace).toHaveBeenCalledTimes(1);
    expect(pickMbArtist(load('musicbrainz-search-tool.json'), 'Toolroom Knights')).toBeNull();
  });

  it('throws on a search fault', async () => {
    await expect(musicbrainzTags('Tool', { userAgent: 'x', fetchImpl: async () => new Response('', { status: 503 }) })).rejects.toThrow(/503/);
  });

  it('has a default User-Agent without a contact set', () => {
    expect(musicbrainzUserAgent(undefined)).toMatch(/^Ember\/1\.0 \( .+ \)$/);
  });
});

describe('createRateLimiter', () => {
  it('spaces calls at the given rate, in order', async () => {
    let clock = 0;
    const waits: number[] = [];
    const limiter = createRateLimiter(4, { now: () => clock, sleep: async (ms) => { waits.push(ms); clock += ms; } });
    const order: number[] = [];
    await Promise.all([1, 2, 3, 4].map((i) => limiter.take().then(() => order.push(i))));
    expect(order).toEqual([1, 2, 3, 4]);
    expect(waits).toEqual([250, 250, 250]);
    clock += 1000;
    await limiter.take();
    expect(waits).toHaveLength(3);
  });

  it('MusicBrainz at 1 a second', async () => {
    let clock = 0;
    const limiter = createRateLimiter(1, { now: () => clock, sleep: async (ms) => { clock += ms; } });
    await limiter.take();
    await limiter.take();
    await limiter.take();
    expect(clock).toBe(2000);
  });
});

describe('needsLookup', () => {
  it('looks up missing rows, refreshes found after 180 days and retries none after 30', () => {
    expect(needsLookup(undefined, T0)).toBe(true);
    expect(needsLookup(row({ key: 'a', fetchedAt: new Date(T0 - FOUND_REFRESH_MS + DAY).toISOString() }), T0)).toBe(false);
    expect(needsLookup(row({ key: 'a', fetchedAt: new Date(T0 - FOUND_REFRESH_MS).toISOString() }), T0)).toBe(true);
    expect(needsLookup(row({ key: 'a', status: 'none', fetchedAt: new Date(T0 - NONE_RETRY_MS + DAY).toISOString() }), T0)).toBe(false);
    expect(needsLookup(row({ key: 'a', status: 'none', fetchedAt: new Date(T0 - NONE_RETRY_MS).toISOString() }), T0)).toBe(true);
  });

  it('never asks about a manual row, always about a chart prior never looked up', () => {
    expect(needsLookup(row({ key: 'a', source: 'manual', fetchedAt: '' }), T0)).toBe(false);
    expect(needsLookup(row({ key: 'a', source: 'chart', fetchedAt: '' }), T0)).toBe(true);
    expect(needsLookup(row({ key: 'a', source: 'chart', fetchedAt: new Date(T0 - DAY).toISOString() }), T0)).toBe(false);
  });
});

describe('createTagger', () => {
  const lastfmFrom = (files: Record<string, string>) => vi.fn(async (name: string) => {
    const f = files[name];
    if (!f) return null;
    return lastfmTopTags(name, 'K', async () => json(load(f)));
  });

  it('looks up the missing artists with Last.fm and writes found rows', async () => {
    const { store, rows } = memoryStore();
    const lastfm = lastfmFrom({ Gojira: 'lastfm-gojira.json', Ceca: 'lastfm-ceca.json' });
    const tagger = createTagger({ store, lastfm, musicbrainz: vi.fn(async () => null), now: () => T0 });
    const got = await tagger.ensureTags([{ name: 'Gojira', artistId: 'UCgoj' }, { name: 'Ceca' }]);
    expect(got.get('gojira')).toMatchObject({ family: 'rock-metal', sub: 'metal', source: 'lastfm', status: 'found', artistId: 'UCgoj' });
    expect(got.get('ceca')).toMatchObject({ family: 'balkan', families: { balkan: 1 }, source: 'lastfm' });
    expect(rows.get('ceca')?.fetchedAt).toBe(new Date(T0).toISOString());
  });

  it('falls back to MusicBrainz when Last.fm does not know them or says nothing mappable', async () => {
    const { store } = memoryStore();
    const lastfm = lastfmFrom({ Somebody: 'lastfm-noise-only.json' });
    const musicbrainz = vi.fn(async (name: string) =>
      musicbrainzTags(name, { userAgent: 'x', fetchImpl: async (url: string) => json(url.includes('/artist/?') ? load('musicbrainz-search-tool.json') : load('musicbrainz-artist-tool.json')) }));
    const tagger = createTagger({ store, lastfm, musicbrainz, now: () => T0 });
    const got = await tagger.ensureTags([{ name: 'Tool' }, { name: 'Somebody' }]);
    expect(got.get('tool')).toMatchObject({ family: 'rock-metal', sub: 'metal', source: 'musicbrainz' });
    expect(musicbrainz).toHaveBeenCalledWith('Somebody');
  });

  it('without a Last.fm key uses MusicBrainz alone', async () => {
    const { store } = memoryStore();
    const musicbrainz = vi.fn(async () => [{ name: 'jazz', count: 3 }]);
    const tagger = createTagger({ store, lastfm: null, musicbrainz, now: () => T0 });
    expect((await tagger.ensureTags([{ name: 'Miles Davis' }])).get('miles davis')).toMatchObject({ family: 'jazz-blues', source: 'musicbrainz' });
  });

  it('writes none when nobody knows them, and does not ask again inside 30 days', async () => {
    const { store, saves } = memoryStore();
    let clock = T0;
    const musicbrainz = vi.fn(async () => null);
    const tagger = createTagger({ store, lastfm: null, musicbrainz, now: () => clock });
    await tagger.ensureTags([{ name: 'Unknown Act' }]);
    expect(saves[0]).toMatchObject({ key: 'unknown act', status: 'none', family: null });
    clock += 29 * DAY;
    await tagger.ensureTags([{ name: 'Unknown Act' }]);
    expect(musicbrainz).toHaveBeenCalledTimes(1);
    clock += 1 * DAY;
    await tagger.ensureTags([{ name: 'Unknown Act' }]);
    expect(musicbrainz).toHaveBeenCalledTimes(2);
  });

  it('writes nothing when a source fails, so the next run tries again', async () => {
    const { store, saves } = memoryStore();
    const warn = vi.fn();
    const lastfm = vi.fn(async () => lastfmTopTags('X', 'K', async () => json(load('lastfm-rate-limited.json'), 429)));
    const tagger = createTagger({ store, lastfm, musicbrainz: null, now: () => T0, warn });
    const got = await tagger.ensureTags([{ name: 'X' }]);
    expect(got.has('x')).toBe(false);
    expect(saves).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith('genres: lookup failed, trying again later', expect.objectContaining({ artist: 'X' }));
  });

  it('asks once for an artist two callers want at the same time', async () => {
    const { store } = memoryStore();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const lastfm = vi.fn(async () => { await gate; return [{ name: 'pop', count: 100 }]; });
    const tagger = createTagger({ store, lastfm, musicbrainz: null, now: () => T0 });
    const a = tagger.ensureTags([{ name: 'Dua Lipa' }]);
    const b = tagger.ensureTags([{ name: 'Dua Lipa feat. DaBaby' }]);
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(lastfm).toHaveBeenCalledTimes(1);
    expect(ra.get('dua lipa')?.family).toBe('pop');
    expect(rb.get('dua lipa')?.family).toBe('pop');
  });

  it('looks up at most maxLookups, in the order given', async () => {
    const { store } = memoryStore();
    const musicbrainz = vi.fn(async (_name: string) => [{ name: 'rock', count: 1 }]);
    const tagger = createTagger({ store, lastfm: null, musicbrainz, now: () => T0 });
    const got = await tagger.ensureTags([{ name: 'A' }, { name: 'B' }, { name: 'C' }], { maxLookups: 2 });
    expect(musicbrainz.mock.calls.map((c) => c[0])).toEqual(['A', 'B']);
    expect([...got.keys()].sort()).toEqual(['a', 'b']);
  });

  it('never replaces a manual row, and does nothing with lookups off', async () => {
    const manual = row({ key: 'band', source: 'manual', family: 'jazz-blues', families: { 'jazz-blues': 1 } });
    const { store } = memoryStore([manual]);
    const musicbrainz = vi.fn(async () => [{ name: 'rock', count: 1 }]);
    const tagger = createTagger({ store, lastfm: null, musicbrainz, now: () => T0 });
    expect((await tagger.ensureTags([{ name: 'Band' }])).get('band')?.family).toBe('jazz-blues');
    expect(musicbrainz).not.toHaveBeenCalled();
    const off = createTagger({ store: memoryStore().store, lastfm: null, musicbrainz: null, now: () => T0 });
    expect((await off.ensureTags([{ name: 'New' }])).size).toBe(0);
  });

  it('keeps a chart prior when the lookup finds nothing, and stops asking for a month', async () => {
    const prior = row({ key: 'balkan star', source: 'chart', family: 'balkan', families: { balkan: 1 }, fetchedAt: '' });
    const { store, rows } = memoryStore([prior]);
    const musicbrainz = vi.fn(async () => null);
    const tagger = createTagger({ store, lastfm: null, musicbrainz, now: () => T0 });
    const got = await tagger.ensureTags([{ name: 'Balkan Star' }]);
    expect(got.get('balkan star')).toMatchObject({ family: 'balkan', source: 'chart', status: 'found', fetchedAt: new Date(T0).toISOString() });
    expect(rows.get('balkan star')?.fetchedAt).toBeTruthy();
    expect(needsLookup(rows.get('balkan star'), T0 + DAY)).toBe(false);
  });

  it('a lookup that finds the artist replaces their chart prior', async () => {
    const prior = row({ key: 'gojira', source: 'chart', family: 'pop', fetchedAt: '' });
    const { store } = memoryStore([prior]);
    const tagger = createTagger({ store, lastfm: lastfmFrom({ Gojira: 'lastfm-gojira.json' }), musicbrainz: null, now: () => T0 });
    expect((await tagger.ensureTags([{ name: 'Gojira' }])).get('gojira')).toMatchObject({ family: 'rock-metal', source: 'lastfm' });
  });
});

describe('applyChartPriors', () => {
  const t = (artist: string) => ({ artist, artistId: null });

  it('adds chart artists with no row, first chart wins, never over an existing row', async () => {
    const { store, rows } = memoryStore([row({ key: 'known', source: 'lastfm', family: 'jazz-blues' })]);
    const tagger = createTagger({ store, lastfm: null, musicbrainz: null, now: () => T0 });
    const n = await tagger.applyChartPriors([
      { slug: 'balkan', tracks: [t('Ceca'), t('Known')] },
      { slug: 'hard-rock-metal', tracks: [t('Gojira'), t('Ceca')] },
      { slug: 'not-a-chart', tracks: [t('Whoever')] },
    ]);
    expect(n).toBe(2);
    expect(rows.get('ceca')).toMatchObject({ family: 'balkan', source: 'chart', fetchedAt: '' });
    expect(rows.get('gojira')).toMatchObject({ family: 'rock-metal', sub: 'metal' });
    expect(rows.get('known')?.family).toBe('jazz-blues');
    expect(rows.has('whoever')).toBe(false);
  });
});

describe('store mapping', () => {
  it('round-trips a row and drops unknown families', () => {
    const r = row({ key: 'gojira', family: 'rock-metal', families: { 'rock-metal': 1 }, sub: 'metal', tags: [{ name: 'metal', count: 1 }] });
    expect(fromRecord(toRecord(r))).toEqual(r);
    expect(fromRecord({ artist_key: 'x', family: 'nope', families: { nope: 1, pop: 0.7 }, sub: 'x', source: 'chart', status: 'found' })).toMatchObject({
      family: null, families: { pop: 0.7 }, sub: null,
    });
  });

  it('quotes filter strings', () => {
    expect(pbQuote('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
});
