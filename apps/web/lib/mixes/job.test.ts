import { describe, expect, it, vi } from 'vitest';
import { chartTracksFor, createMixJob, LAZY_RETRY_MS, localDay, otherChartArtists, STALE_AFTER_MS, type MixJobDeps, type MixRow, type StoredMix } from './job';
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
  it('builds a pure mix per family the member plays, heaviest first', async () => {
    const w = world();
    const r = await createMixJob(w.deps).buildMember('u1');
    expect(r).toMatchObject({ eligible: true, written: ['rock-metal', 'pop'], deleted: [], kept: [] });
    const rows = [...w.mixes.values()].sort((a, b) => a.position - b.position);
    expect(rows.map((m) => [m.key, m.title, m.position])).toEqual([['rock-metal', 'Rock & Metal', 0], ['pop', 'Pop', 1]]);
    for (const m of rows) {
      expect(m.tracks.length).toBeGreaterThanOrEqual(20);
      expect(m.tracks.every((t) => family[artistKey(t.artist)] === (m.key === 'pop' ? 'pop' : 'rock-metal'))).toBe(true);
      expect(m.seeds).toHaveLength(4);
      expect(m.cover.artworkUrls.length).toBeGreaterThan(0);
      expect(m.subtitle).toMatch(/ and more$/);
      expect(m.builtAt).toBe(new Date(NOW).toISOString());
    }
    // One radio-batch call per mix, four seeds each.
    expect(w.radioBatch).toHaveBeenCalledTimes(2);
    expect(w.radioBatch.mock.calls.every((c) => c[0].length === 4)).toBe(true);
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
    expect([...w.mixes.values()].map((m) => m.key)).toEqual(['rock-metal']);
  });

  it('a YouTube outage keeps the last mixes as they were', async () => {
    const w = world();
    await createMixJob(w.deps).buildMember('u1');
    const before = JSON.stringify([...w.mixes.values()]);
    w.deps.radioBatch = vi.fn(async () => { throw new Error('every seed failed'); });
    const warn = vi.fn();
    const r = await createMixJob({ ...w.deps, warn, now: () => NOW + 24 * HOUR }).buildMember('u1');
    expect(r).toMatchObject({ written: [], kept: ['rock-metal', 'pop'], deleted: [] });
    expect(JSON.stringify([...w.mixes.values()])).toBe(before);
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
    expect(w.radioBatch).toHaveBeenCalledTimes(2);
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
