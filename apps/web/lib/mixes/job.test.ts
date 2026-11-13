import { describe, expect, it, vi } from 'vitest';
import { chartTracksFor, createMixJob, LAZY_RETRY_MS, localDay, otherChartArtists, SHORT_KEEP_MS, STALE_AFTER_MS, WEEKLY_STALE_AFTER_MS, type MixJobDeps, type MixRow, type StoredMix } from './job';
import { MAX_MIXES, mixKind } from './kinds';
import { songKey } from '../songKey';
import { createTagger, type ArtistGenre, type GenreStore } from '../genres/tagger';
import { artistKey } from '../genres/artistKey';
import type { FamilySlug } from '../genres/taxonomy';
import { tt } from '@/test-utils/mixTracks';
import type { Track } from '@/types/track';

// The mix job against a fake player (radio-batch), a fake tagger (an
// in-memory artist_genres with a fake MusicBrainz) and an in-memory mixes
// store. No network, no PocketBase.

const NOW = Date.parse('2026-10-16T04:30:00');
const HOUR = 3600000;

const family: Record<string, FamilySlug> = {};
const rockBands = Array.from({ length: 6 }, (_, i) => `Rock Band ${i}`);
const popStars = Array.from({ length: 4 }, (_, i) => `Pop Star ${i}`);
const newRock = Array.from({ length: 30 }, (_, i) => `New Rock ${i}`);
const newPop = Array.from({ length: 30 }, (_, i) => `New Pop ${i}`);
for (const b of [...rockBands, ...newRock]) family[artistKey(b)] = 'rock-metal';
for (const b of [...popStars, ...newPop]) family[artistKey(b)] = 'pop';

const songsOf = (names: string[], per: number) => names.flatMap((n, i) => Array.from({ length: per }, (_, j) => tt(`${i}x${j}${n.slice(0, 3)}`, n, `${n} Song ${j}`)));
const rockSongs = songsOf(rockBands, 4);
const popSongs = songsOf(popStars, 4);

function playsOf(tracks: Track[], times: number) {
  return tracks.flatMap((track) => Array.from({ length: times }, (_, k) => ({ track, playedAt: new Date(NOW - (k + 1) * HOUR).toISOString() })));
}

function world(over: Partial<MixJobDeps> = {}, { plays = [...playsOf(rockSongs, 2), ...playsOf(popSongs, 1)] } = {}) {
  const genreRows = new Map<string, ArtistGenre>();
  const genreStore: GenreStore = {
    async getMany(keys) { return new Map(keys.filter((k) => genreRows.has(k)).map((k) => [k, genreRows.get(k)!])); },
    async save(row) { genreRows.set(row.key, row); },
  };
  const musicbrainz = vi.fn(async (name: string) => {
    const f = family[artistKey(name)];
    return f ? [{ name: f === 'pop' ? 'pop' : 'rock', count: 5 }] : null;
  });
  const tagger = createTagger({ store: genreStore, lastfm: null, musicbrainz, now: () => NOW });
  const mixes = new Map<string, MixRow & { id: string; user: string }>();
  let nextId = 1;
  const radioBatch = vi.fn(async (seeds: string[]) => ({
    radios: seeds.map((seed, si) => {
      const isPop = popSongs.some((t) => t.sourceId === seed);
      const pool = isPop ? newPop : newRock;
      // A leak of the other family in every radio.
      const leak = (isPop ? newRock : newPop)[si];
      return { seed, tracks: [...pool.map((n, i) => tt(`n${si}${i}${n.length}${seed.slice(0, 2)}`, n, `${n} Radio ${i}`)), tt(`l${si}${seed.slice(0, 5)}`, leak, `${leak} Leak`)] };
    }),
    failed: [],
  }));
  const deps: MixJobDeps = {
    listActiveMembers: vi.fn(async () => ['u1']),
    loadPlays: vi.fn(async () => plays),
    loadLikes: vi.fn(async () => []),
    ensureTags: (refs, opts) => tagger.ensureTagsCounted(refs, opts),
    radioBatch,
    genreCharts: async () => [],
    unavailableIds: async () => new Set<string>(),
    listMixes: async (userId) => [...mixes.values()].filter((m) => m.user === userId).map((m) => ({ id: m.id, key: m.key, builtAt: m.builtAt })),
    saveMix: async (userId, row) => {
      const old = [...mixes.values()].find((m) => m.user === userId && m.key === row.key);
      mixes.set(old?.id ?? `m${nextId++}`, { ...row, id: old?.id ?? `m${nextId - 1}`, user: userId });
    },
    deleteMix: async (id) => { mixes.delete(id); },
    now: () => NOW,
    ...over,
  };
  return { deps, mixes, radioBatch, musicbrainz, genreRows };
}

describe('buildMember', () => {
  it('builds a pure style mix per family the member plays, heaviest first', async () => {
    const w = world();
    const r = await createMixJob(w.deps).buildMember('u1');
    expect(r).toMatchObject({ eligible: true, deleted: [], kept: [] });
    expect(r.written.slice(0, 2)).toEqual(['rock-metal', 'pop']);
    const rows = [...w.mixes.values()].filter((m) => mixKind(m.key) === 'style').sort((a, b) => a.position - b.position);
    expect(rows.map((m) => [m.key, m.title, m.position])).toEqual([['rock-metal', 'Rock & Metal', 0], ['pop', 'Pop', 1]]);
    for (const m of rows) {
      expect(m.tracks.length).toBeGreaterThanOrEqual(20);
      expect(m.tracks.every((t) => family[artistKey(t.artist)] === (m.key === 'pop' ? 'pop' : 'rock-metal'))).toBe(true);
      expect(m.seeds).toHaveLength(4);
      expect(m.cover.artworkUrls.length).toBeGreaterThan(0);
      expect(m.subtitle).toMatch(/ and more$/);
      expect(m.builtAt).toBe(new Date(NOW).toISOString());
    }
    // The style mixes' radio came first, four seeds each.
    expect(w.radioBatch.mock.calls[0][0]).toHaveLength(4);
    expect(w.radioBatch.mock.calls[1][0]).toHaveLength(4);
  });

  it('a member under the threshold gets nothing, and loses old rows', async () => {
    const w = world({}, { plays: playsOf(rockSongs.slice(0, 3), 1) });
    w.mixes.set('old', { id: 'old', user: 'u1', key: 'pop', title: 'Pop', subtitle: '', position: 0, tracks: [], seeds: [], cover: { artworkUrls: [], color: '' }, builtAt: '' });
    const r = await createMixJob(w.deps).buildMember('u1');
    expect(r).toMatchObject({ eligible: false, written: [], deleted: ['pop'] });
    expect(w.mixes.size).toBe(0);
    expect(w.radioBatch).not.toHaveBeenCalled();
  });

  it('deletes a family that is no longer eligible, keeps the others', async () => {
    const w = world({}, { plays: playsOf(rockSongs, 2) });
    w.mixes.set('oldpop', { id: 'oldpop', user: 'u1', key: 'pop', title: 'Pop', subtitle: '', position: 1, tracks: [], seeds: [], cover: { artworkUrls: [], color: '' }, builtAt: '' });
    const r = await createMixJob(w.deps).buildMember('u1');
    expect(r.deleted).toEqual(['pop']);
    expect([...w.mixes.values()].map((m) => m.key).filter((k) => mixKind(k) === 'style')).toEqual(['rock-metal']);
  });

  it('a YouTube outage keeps the last radio mixes as they were', async () => {
    const w = world();
    await createMixJob(w.deps).buildMember('u1');
    const radioRows = () => JSON.stringify([...w.mixes.values()].filter((m) => m.key !== 'on-repeat'));
    const before = radioRows();
    w.deps.radioBatch = vi.fn(async () => { throw new Error('every seed failed'); });
    const warn = vi.fn();
    const r = await createMixJob({ ...w.deps, warn, now: () => NOW + 24 * HOUR }).buildMember('u1');
    // On repeat needs no radio; everything else stays as it was.
    expect(r).toMatchObject({ written: ['on-repeat'], deleted: [] });
    expect(r.kept.slice(0, 3)).toEqual(['rock-metal', 'pop', 'discover']);
    expect(radioRows()).toBe(before);
    expect(warn).toHaveBeenCalledWith('mixes: radio failed, keeping the last mix', expect.objectContaining({ mix: 'rock-metal' }));
  });

  it('tags new radio artists before assembling, within the lookup budget', async () => {
    const w = world();
    await createMixJob(w.deps).buildMember('u1');
    // Own artists (10) plus the radio newcomers were looked up.
    expect(w.musicbrainz.mock.calls.length).toBeGreaterThan(10);
    expect(w.musicbrainz.mock.calls.length).toBeLessThanOrEqual(100);
    expect(w.genreRows.get(artistKey('New Rock 3'))?.family).toBe('rock-metal');
  });

  it('a rerun on the same day picks the same seeds', async () => {
    const w = world();
    const job = createMixJob(w.deps);
    await job.buildMember('u1');
    const seeds = [...w.mixes.values()].map((m) => m.seeds.join());
    await job.buildMember('u1');
    expect([...w.mixes.values()].map((m) => m.seeds.join())).toEqual(seeds);
  });
});

describe('every kind', () => {
  const DAY = 24 * HOUR;
  const oldBands = ['Old Band A', 'Old Band B', 'Old Band C'];
  const oldSongs = songsOf(oldBands, 4);
  const oldPlays = oldSongs.flatMap((track) => Array.from({ length: 4 }, (_, k) => ({ track, playedAt: new Date(NOW - (100 + k) * DAY).toISOString() })));
  const fullPlays = () => [...playsOf(rockSongs, 2), ...playsOf(popSongs, 1), ...oldPlays];
  const order = ['style', 'discover', 'on-repeat', 'artist', 'throwback'];
  const sorted = (mixes: Map<string, MixRow & { id: string }>) => [...mixes.values()].sort((a, b) => a.position - b.position);

  it('lines up style, Discover, On repeat, artist and Throwback mixes, at most twelve, in that order', async () => {
    const w = world({}, { plays: fullPlays() });
    const r = await createMixJob(w.deps).buildMember('u1');
    expect(r.kept).toEqual([]);
    const rows = sorted(w.mixes);
    expect(rows.length).toBeLessThanOrEqual(MAX_MIXES);
    const kinds = rows.map((m) => mixKind(m.key));
    expect(new Set(kinds)).toEqual(new Set(order));
    // Kinds never interleave.
    expect(kinds.map((k) => order.indexOf(k))).toEqual([...kinds.map((k) => order.indexOf(k))].sort((a, b) => a - b));
    // Two styles leave room: six artist mixes instead of four.
    expect(kinds.filter((k) => k === 'artist')).toHaveLength(6);
    expect(rows.map((m) => m.position)).toEqual([0, 1, 10, 20, 30, 31, 32, 33, 34, 35, 40]);
    expect(rows.find((m) => m.key === 'discover')?.title).toBe('New to you');
    expect(rows.find((m) => m.key === 'on-repeat')?.title).toBe('Your top songs');
    expect(rows.find((m) => m.key === 'throwback')?.title).toBe('Back again');
  });

  it('an artist mix is the artist plus similar artists, the artist capped at twelve and the others at three', async () => {
    const w = world({}, { plays: fullPlays() });
    await createMixJob(w.deps).buildMember('u1');
    const m = w.mixes.get([...w.mixes.keys()].find((id) => w.mixes.get(id)!.key === 'artist-rock-band-0')!)!;
    expect(m).toMatchObject({ title: 'Rock Band 0' });
    expect(m.subtitle).toMatch(/^Rock Band 0, .+ and more$/);
    const counts = new Map<string, number>();
    for (const t of m.tracks) counts.set(t.artist, (counts.get(t.artist) ?? 0) + 1);
    expect(counts.get('Rock Band 0')).toBeGreaterThanOrEqual(4);
    expect(counts.get('Rock Band 0')).toBeLessThanOrEqual(12);
    for (const [a, n] of counts) if (a !== 'Rock Band 0') expect(n).toBeLessThanOrEqual(3);
    // Similar artists from the radio, never the other family's leak.
    expect(m.tracks.some((t) => t.artist.startsWith('New Rock'))).toBe(true);
    expect(m.tracks.every((t) => family[artistKey(t.artist)] === 'rock-metal')).toBe(true);
    expect(m.tracks.length).toBeGreaterThanOrEqual(20);
    expect(m.cover.artworkUrls[0]).toBe(rockSongs.find((t) => t.artist === 'Rock Band 0')!.artworkUrl);
  });

  it('Discover holds only songs never played or liked, artists new to the member first', async () => {
    const w = world({}, { plays: fullPlays() });
    await createMixJob(w.deps).buildMember('u1');
    const d = sorted(w.mixes).find((m) => m.key === 'discover')!;
    const heard = new Set([...rockSongs, ...popSongs, ...oldSongs].map(songKey));
    const mine = new Set([...rockBands, ...popStars, ...oldBands]);
    expect(d.tracks.length).toBeGreaterThanOrEqual(20);
    expect(d.tracks.length).toBeLessThanOrEqual(30);
    expect(d.tracks.some((t) => heard.has(songKey(t)))).toBe(false);
    expect(d.tracks.some((t) => mine.has(t.artist))).toBe(false);
    expect(d.seeds.length).toBeGreaterThan(0);
  });

  it('On repeat is this month\'s most played; Throwback the songs played a lot before but not lately', async () => {
    const w = world({}, { plays: fullPlays() });
    await createMixJob(w.deps).buildMember('u1');
    const rows = sorted(w.mixes);
    const repeat = rows.find((m) => m.key === 'on-repeat')!;
    // Rock songs were played twice this month, pop songs once.
    expect(repeat.tracks.every((t) => rockBands.includes(t.artist))).toBe(true);
    expect(repeat.tracks.length).toBeGreaterThanOrEqual(10);
    const back = rows.find((m) => m.key === 'throwback')!;
    expect(back.tracks.map((t) => t.artist).sort()).toEqual(oldSongs.map((t) => t.artist).sort());
  });

  it('Discover is built once a week: kept through Sunday, rebuilt on Monday', async () => {
    let clock = NOW; // Friday 16 October
    const w = world({ now: () => clock }, { plays: fullPlays() });
    const job = createMixJob(w.deps);
    await job.buildMember('u1');
    const first = sorted(w.mixes).find((m) => m.key === 'discover')!;
    clock = NOW + 2 * DAY; // Sunday
    const sunday = await job.buildMember('u1');
    expect(sunday.kept).toContain('discover');
    expect(sorted(w.mixes).find((m) => m.key === 'discover')!.builtAt).toBe(first.builtAt);
    clock = NOW + 3 * DAY; // Monday
    const monday = await job.buildMember('u1');
    expect(monday.written).toContain('discover');
    expect(sorted(w.mixes).find((m) => m.key === 'discover')!.builtAt).toBe(new Date(clock).toISOString());
  });

  it('a blocked song is left out of every kind', async () => {
    const blocked = rockSongs[0];
    const w = world({ loadBlocked: async () => [blocked] }, { plays: fullPlays() });
    await createMixJob(w.deps).buildMember('u1');
    expect(w.mixes.size).toBeGreaterThan(5);
    for (const m of w.mixes.values()) expect(m.tracks.some((t) => songKey(t) === songKey(blocked))).toBe(false);
  });

  it('a dead song is left out of every kind', async () => {
    const dead = rockSongs[1];
    const w = world({ unavailableIds: async () => new Set([dead.id]) }, { plays: fullPlays() });
    await createMixJob(w.deps).buildMember('u1');
    for (const m of w.mixes.values()) expect(m.tracks.some((t) => t.id === dead.id)).toBe(false);
  });

  it('fetches each seed\'s radio once per build, however many mixes share it', async () => {
    const w = world({}, { plays: fullPlays() });
    await createMixJob(w.deps).buildMember('u1');
    const all = w.radioBatch.mock.calls.flatMap((c) => c[0]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('a dead or blocked song is never a radio seed', async () => {
    const dead = rockSongs[0];
    const blocked = rockSongs[4];
    const w = world({ unavailableIds: async () => new Set([dead.id]), loadBlocked: async () => [blocked] }, { plays: fullPlays() });
    await createMixJob(w.deps).buildMember('u1');
    const seeds = w.radioBatch.mock.calls.flatMap((c) => c[0]);
    expect(seeds.length).toBeGreaterThan(0);
    expect(seeds).not.toContain(dead.sourceId);
    expect(seeds).not.toContain(blocked.sourceId);
  });

  it('a mix that keeps coming out short is kept a few days, then deleted; an outage never deletes', async () => {
    let clock = NOW;
    const w = world({ now: () => clock }, { plays: fullPlays() });
    const job = createMixJob(w.deps);
    await job.buildMember('u1');
    expect([...w.mixes.values()].some((m) => m.key === 'artist-rock-band-0')).toBe(true);
    // From now on every radio is empty: the radio mixes come out short.
    w.deps.radioBatch = vi.fn(async (seeds: string[]) => ({ radios: seeds.map((seed) => ({ seed, tracks: [] })), failed: [] }));
    clock = NOW + DAY;
    expect((await job.buildMember('u1')).kept).toContain('artist-rock-band-0');
    clock = NOW + SHORT_KEEP_MS;
    const r = await job.buildMember('u1');
    expect(r.deleted).toContain('artist-rock-band-0');
    expect(r.deleted).toContain('rock-metal');
    // An outage (every seed failing) keeps them however old.
    const w2 = world({ now: () => clock }, { plays: fullPlays() });
    const job2 = createMixJob({ ...w2.deps, now: () => NOW });
    await job2.buildMember('u1');
    w2.deps.radioBatch = vi.fn(async () => { throw new Error('every seed failed'); });
    const r2 = await createMixJob({ ...w2.deps, now: () => NOW + 10 * DAY }).buildMember('u1');
    expect(r2.deleted).toEqual([]);
    expect(r2.kept).toContain('artist-rock-band-0');
  });

  it('a member with too little listening gets no style, artist or Discover mix', async () => {
    const w = world({}, { plays: playsOf(rockSongs.slice(0, 3), 1) });
    const r = await createMixJob(w.deps).buildMember('u1');
    expect(r.written).toEqual([]);
    expect(w.radioBatch).not.toHaveBeenCalled();
  });
});

describe('queue and lazy trigger', () => {
  it('runAll builds every active member once, one at a time', async () => {
    const w = world({ listActiveMembers: vi.fn(async () => ['u1', 'u2', 'u1']) });
    let active = 0;
    let maxActive = 0;
    const load = w.deps.loadPlays;
    w.deps.loadPlays = async (...a) => { active++; maxActive = Math.max(maxActive, active); await new Promise((r) => setTimeout(r, 5)); active--; return load(...a); };
    const job = createMixJob(w.deps);
    expect(await job.runAll()).toBe(3);
    expect(maxActive).toBe(1);
    expect(new Set([...w.mixes.values()].map((m) => m.user))).toEqual(new Set(['u1', 'u2']));
  });

  it('requestBuild queues a member with no mixes, once, and not again while it runs', async () => {
    const w = world();
    const job = createMixJob(w.deps);
    expect(job.requestBuild('u1', [])).toBe(true);
    expect(job.isBuilding('u1')).toBe(true);
    expect(job.requestBuild('u1', [])).toBe(true);
    await job.idle();
    // Built once: one radio call per radio mix.
    const radioMixes = [...w.mixes.keys()].length - 1;
    expect(w.radioBatch.mock.calls.length).toBeLessThanOrEqual(radioMixes);
    expect(w.mixes.size).toBeGreaterThan(2);
    expect(job.isBuilding('u1')).toBe(false);
  });

  it('fresh mixes need no build; mixes past 36 hours do', () => {
    let clock = NOW;
    const job = createMixJob(world({ now: () => clock }).deps);
    const fresh: Pick<StoredMix, 'builtAt'>[] = [{ builtAt: new Date(NOW - 2 * HOUR).toISOString() }];
    expect(job.requestBuild('u1', fresh)).toBe(false);
    clock = NOW + STALE_AFTER_MS;
    expect(job.requestBuild('u1', fresh)).toBe(true);
  });

  it('a Discover row a few days old does not make the mixes stale; past a week and a day it does', () => {
    let clock = NOW;
    const job = createMixJob(world({ now: () => clock }).deps);
    const rows = (discoverAge: number) => [
      { key: 'rock-metal', builtAt: new Date(clock - 2 * HOUR).toISOString() },
      { key: 'discover', builtAt: new Date(clock - discoverAge).toISOString() },
    ];
    expect(job.requestBuild('u1', rows(3 * 24 * HOUR))).toBe(false);
    clock += 1;
    expect(job.requestBuild('u1', rows(WEEKLY_STALE_AFTER_MS))).toBe(true);
  });

  it('after a build that made nothing, waits six hours before trying that member again', async () => {
    let clock = NOW;
    const w = world({ now: () => clock }, { plays: [] });
    const job = createMixJob(w.deps);
    expect(job.requestBuild('u1', [])).toBe(true);
    await job.idle();
    expect(job.lastResult('u1')).toEqual({ eligible: false });
    expect(job.requestBuild('u1', [])).toBe(false);
    clock += LAZY_RETRY_MS;
    expect(job.requestBuild('u1', [])).toBe(true);
    await job.idle();
  });
});

describe('chart helpers', () => {
  const charts = [
    { slug: 'rock', tracks: [tt('r1', 'Rocker')] },
    { slug: 'hard-rock-metal', tracks: [tt('m1', 'Metalhead')] },
    { slug: 'pop', tracks: [tt('p1', 'Popstar')] },
  ];
  it('gives a mix its family charts, its own half first', () => {
    expect(chartTracksFor({ family: 'rock-metal', sub: 'metal' }, charts).map((t) => t.artist)).toEqual(['Metalhead', 'Rocker']);
    expect(chartTracksFor({ family: 'pop', sub: null }, charts).map((t) => t.artist)).toEqual(['Popstar']);
  });
  it('lists the artists of other families\' charts', () => {
    expect([...otherChartArtists('rock-metal', charts)]).toEqual(['popstar']);
  });
  it('days are local calendar days', () => {
    expect(localDay(Date.parse('2026-10-16T04:30:00'))).toBe('2026-10-16');
  });
});
