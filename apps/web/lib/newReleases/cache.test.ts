import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { artistKey } from '@/lib/genres/artistKey';
import type { FamilySlug } from '@/lib/genres/taxonomy';
import type { NewReleasesExploreItem, NewReleasesFetch } from '@/lib/sources/youtube';
import {
  createNewReleasesCache,
  FAMILY_LOOKUPS_PER_RUN,
  MEMBER_LOOKUPS_PER_RUN,
  NEW_RELEASES_RETRY_MS,
  NEW_RELEASES_TTL_MS,
  type MemberLikes,
  type NewReleasesCache,
} from './cache';
import { emptyLedger, type Ledger, type LikeRow } from './rules';

const HOUR = 60 * 60 * 1000;
const EMPTY = { refreshedAt: null, stale: false, releases: [] };

const id = (n: number) => `UC${String(n).padStart(8, '0')}`;
const iso = (ms: number) => new Date(ms).toISOString();

const like = (n: number, over: Partial<LikeRow> = {}): LikeRow => ({
  source: 'youtube',
  artistId: id(n),
  artist: `A${n}`,
  likedAt: '2026-10-01T00:00:00.000Z',
  created: '2026-10-01T00:00:00.000Z',
  ...over,
});
const member = (mid: string, ns: number[]): MemberLikes => ({ id: mid, likes: ns.map((n) => like(n)) });
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const rel = (browseId: string) => ({ browseId, title: `T ${browseId}`, kind: 'single' as const, year: 2026, artworkUrl: null });
/** An item of YouTube's own shelf: always new the first time it is seen. */
const shelf = (browseId: string, over: Partial<NewReleasesExploreItem> = {}): NewReleasesExploreItem => ({
  browseId,
  title: `S ${browseId}`,
  kind: 'album',
  year: null,
  artworkUrl: null,
  artist: 'Shelf',
  artistId: id(99),
  ...over,
});

const fetched = (ids: readonly string[], over: Partial<NewReleasesFetch> = {}): NewReleasesFetch => ({
  artists: ids.map((a) => ({ id: a, name: `N ${a}`, releases: [rel(`r-${a}`)] })),
  explore: [],
  failed: [],
  ...over,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** The runs are started in the background, so a test waits for the one it
 *  asked for rather than for a fixed number of ticks. */
const settled = (cache: NewReleasesCache) => vi.waitFor(() => expect(cache.busy()).toBe(false));

type Deps = Parameters<typeof createNewReleasesCache>[0];
/** Mocks that keep the dep's own signature, so the call assertions below
 *  see both arguments. */
const fetchFake = (impl: Deps['fetchReleases']) => vi.fn(impl);
const familiesFake = (impl: Deps['familiesOf']) => vi.fn(impl);
const warnFake = () => vi.fn<NonNullable<Deps['warn']>>();

let dir: string;
let file: string;
let clock: number;
let members: MemberLikes[];
let charts: { slug: string; tracks: { artistId: string | null }[] }[];
let chartsBusy: boolean;
let warn: ReturnType<typeof warnFake>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-new-releases-'));
  file = path.join(dir, 'new-releases.json');
  clock = Date.parse('2026-11-22T08:00:00Z');
  members = [];
  charts = [];
  chartsBusy = false;
  warn = warnFake();
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function make(over: Partial<Deps> = {}) {
  return createNewReleasesCache({
    fetchReleases: async (ids) => fetched(ids),
    loadMemberLikes: async () => members,
    genreCharts: async () => charts,
    chartsBusy: () => chartsBusy,
    // Like the real tagger: every artist gets a row, "none" when unknown.
    familiesOf: async (refs) => new Map(refs.map((r) => [artistKey(r.name), { family: null as FamilySlug | null }])),
    cacheFile: file,
    now: () => clock,
    warn,
    ...over,
  });
}

function seedMirror(over: Partial<Ledger>) {
  fs.writeFileSync(file, JSON.stringify({ ...emptyLedger(), ...over }));
}

const readMirrorFile = (): Ledger => JSON.parse(fs.readFileSync(file, 'utf8')) as Ledger;

describe('createNewReleasesCache', () => {
  it('a cold start answers empty without waiting and starts exactly one run', async () => {
    const gate = deferred<NewReleasesFetch>();
    const fetchReleases = fetchFake(() => gate.promise);
    members = [member('m1', [1, 2])];
    const cache = make({ fetchReleases });

    // The run takes about a minute, so neither read waits for it.
    expect(await cache.get()).toEqual(EMPTY);
    expect(await cache.get()).toEqual(EMPTY);
    await vi.waitFor(() => expect(fetchReleases).toHaveBeenCalledTimes(1));

    gate.resolve(fetched([id(1), id(2)], { explore: [shelf('x')] }));
    await settled(cache);
    const after = await cache.get();
    expect(after.refreshedAt).toBe(iso(clock));
    expect(after.stale).toBe(false);
    expect(after.releases.map((r) => r.browseId)).toEqual(['x']);
    expect(fetchReleases).toHaveBeenCalledTimes(1);
  });

  it('fetches nothing inside the TTL and, past it, serves the old list stale while one run starts', async () => {
    const fetchReleases = fetchFake(async (ids) => fetched(ids, { explore: [shelf('x')] }));
    members = [member('m1', [1])];
    const cache = make({ fetchReleases });
    await cache.get();
    await settled(cache);

    clock += 23 * HOUR;
    const inside = await cache.get();
    expect(inside.stale).toBe(false);
    expect(inside.releases.map((r) => r.browseId)).toEqual(['x']);
    expect(cache.busy()).toBe(false);
    expect(fetchReleases).toHaveBeenCalledTimes(1);

    clock += 2 * HOUR;
    const reads = await Promise.all(range(1, 10).map(() => cache.get()));
    for (const read of reads) {
      expect(read.stale).toBe(true);
      expect(read.releases.map((r) => r.browseId)).toEqual(['x']);
    }
    await settled(cache);
    expect(fetchReleases).toHaveBeenCalledTimes(2);
    expect((await cache.get()).stale).toBe(false);
  });

  it('gives the player at most 18 ids and explore: true, the least recently checked first', async () => {
    const fetchReleases = fetchFake(async (ids) => fetched(ids));
    members = [member('m1', range(1, 40))];
    charts = [{ slug: 'pop', tracks: range(101, 110).map((n) => ({ artistId: id(n) })) }];
    // Every liked artist is pop, so the genre watchlist is the pop chart's.
    const familiesOf = familiesFake(async (_refs, opts) =>
      opts.maxLookups === 0
        ? new Map<string, { family: FamilySlug | null }>(range(1, 40).map((n) => [`a${n}`, { family: 'pop' }]))
        : new Map<string, { family: FamilySlug | null }>(),
    );
    seedMirror({
      refreshedAt: iso(clock - 48 * HOUR),
      // id(40) is the oldest check, id(1) the newest.
      artists: Object.fromEntries(
        range(1, 40).map((n) => [id(n), { name: `A${n}`, checkedAt: iso(clock - n * HOUR), scannedAt: iso(clock - n * HOUR), known: [] }]),
      ),
    });

    const cache = make({ fetchReleases, familiesOf });
    await cache.get();
    await settled(cache);

    expect(fetchReleases).toHaveBeenCalledTimes(1);
    const [ids, opts] = fetchReleases.mock.calls[0];
    expect(opts).toEqual({ explore: true });
    expect(ids).toHaveLength(18);
    // 12 liked artists, oldest check first; then 6 never-checked chart artists in rank order.
    expect(ids).toEqual([...range(29, 40).reverse().map(id), ...range(101, 106).map(id)]);
  });

  it('steps aside while the genre charts are refreshing and tries again after the retry time', async () => {
    const fetchReleases = fetchFake(async (ids) => fetched(ids, { explore: [shelf('x')] }));
    members = [member('m1', [1])];
    chartsBusy = true;
    const cache = make({ fetchReleases });
    await cache.get();
    await settled(cache);
    expect(fetchReleases).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('new releases: the genre charts are refreshing, trying again later');

    // Inside the retry window nothing is tried again.
    clock += NEW_RELEASES_RETRY_MS - 1;
    await cache.get();
    expect(cache.busy()).toBe(false);
    expect(fetchReleases).not.toHaveBeenCalled();

    clock += 1;
    chartsBusy = false;
    await cache.get();
    await settled(cache);
    expect(fetchReleases).toHaveBeenCalledTimes(1);
    expect((await cache.get()).releases.map((r) => r.browseId)).toEqual(['x']);
  });

  it('a whole run failing keeps the ledger and waits the retry time', async () => {
    let run = 0;
    const fetchReleases = fetchFake(async (ids) => {
      if (++run === 1) return fetched(ids, { explore: [shelf('x')] });
      throw new Error('player down');
    });
    members = [member('m1', [1])];
    const cache = make({ fetchReleases });
    await cache.get();
    await settled(cache);

    clock += NEW_RELEASES_TTL_MS + 1;
    const stale = await cache.get();
    expect(stale.stale).toBe(true);
    expect(stale.releases.map((r) => r.browseId)).toEqual(['x']);
    await settled(cache);
    expect(warn).toHaveBeenCalledWith('new releases: the run failed, keeping the ledger', { reason: 'player down' });

    const kept = await cache.get();
    expect(kept.releases.map((r) => r.browseId)).toEqual(['x']);
    expect(kept.stale).toBe(true);
    expect(kept.refreshedAt).toBe(iso(clock - NEW_RELEASES_TTL_MS - 1));
    expect(fetchReleases).toHaveBeenCalledTimes(2);

    clock += NEW_RELEASES_RETRY_MS;
    await cache.get();
    await settled(cache);
    expect(fetchReleases).toHaveBeenCalledTimes(3);
  });

  it('a partial failure keeps the failed artist known list and moves its check on', async () => {
    const fetchReleases = fetchFake(async () => ({
      artists: [{ id: id(2), name: 'A2', releases: [rel('new2')] }],
      explore: [],
      failed: [id(1)],
    }));
    members = [member('m1', [1, 2])];
    seedMirror({
      refreshedAt: iso(clock - 48 * HOUR),
      artists: {
        [id(1)]: { name: 'A1', checkedAt: iso(clock - 48 * HOUR), scannedAt: iso(clock - 48 * HOUR), known: ['old1', 'old2'] },
      },
    });
    const cache = make({ fetchReleases });
    await cache.get();
    await settled(cache);

    const mirror = readMirrorFile();
    expect(mirror.artists[id(1)].known).toEqual(['old1', 'old2']);
    expect(mirror.artists[id(1)].checkedAt).toBe(iso(clock));
    expect(mirror.artists[id(2)].known).toEqual(['new2']);
    expect(warn).toHaveBeenCalledWith('new releases: some artists failed, keeping their known lists', { failed: [id(1)] });
  });

  it('writes the mirror, and a new cache on the same file serves it at once', async () => {
    const first = fetchFake(async (ids) => fetched(ids, { explore: [shelf('x')] }));
    members = [member('m1', [1])];
    const cache = make({ fetchReleases: first });
    await cache.get();
    await settled(cache);
    expect(readMirrorFile().releases.map((r) => r.browseId)).toEqual(['x']);

    const second = fetchFake(async (ids) => fetched(ids));
    const restarted = make({ fetchReleases: second });
    const got = await restarted.get();
    expect(got.releases.map((r) => r.browseId)).toEqual(['x']);
    expect(got.refreshedAt).toBe(iso(clock));
    expect(got.stale).toBe(false);
    await settled(restarted);
    expect(second).not.toHaveBeenCalled();
  });

  it('a corrupt mirror is a cold start', async () => {
    fs.writeFileSync(file, '{not json');
    const fetchReleases = fetchFake(async (ids) => fetched(ids, { explore: [shelf('x')] }));
    members = [member('m1', [1])];
    const cache = make({ fetchReleases });
    expect(await cache.get()).toEqual(EMPTY);
    await settled(cache);
    expect(fetchReleases).toHaveBeenCalledTimes(1);
    expect((await cache.get()).releases.map((r) => r.browseId)).toEqual(['x']);
  });

  it('gives the new releases their family with 25 lookups at most', async () => {
    const fetchReleases = fetchFake(async (ids) => fetched(ids, { explore: [shelf('x')] }));
    members = [member('m1', [1])];
    const familiesOf = familiesFake(async (_refs, opts) =>
      opts.maxLookups === 0
        ? new Map<string, { family: FamilySlug | null }>()
        : new Map<string, { family: FamilySlug | null }>([['shelf', { family: 'pop' }]]),
    );
    const cache = make({ fetchReleases, familiesOf });
    await cache.get();
    await settled(cache);

    expect(FAMILY_LOOKUPS_PER_RUN).toBe(25);
    expect(familiesOf).toHaveBeenCalledWith(
      [{ name: 'Shelf', artistId: id(99) }],
      { maxLookups: FAMILY_LOOKUPS_PER_RUN },
    );
    // The members' own genres are read from stored rows only.
    expect(familiesOf).toHaveBeenCalledWith(expect.anything(), { maxLookups: 0 });
    expect((await cache.get()).releases[0].family).toBe('pop');
  });

  it('a tagger that throws costs the run nothing', async () => {
    const fetchReleases = fetchFake(async (ids) => fetched(ids, { explore: [shelf('x')] }));
    members = [member('m1', [1])];
    const familiesOf = familiesFake(async () => { throw new Error('lastfm down'); });
    const cache = make({ fetchReleases, familiesOf });
    await cache.get();
    await settled(cache);

    const got = await cache.get();
    expect(got.releases.map((r) => r.browseId)).toEqual(['x']);
    expect(got.releases[0].family).toBeNull();
    // Not fresh: the family is still missing, so the answer says stale.
    expect(got.stale).toBe(true);
    expect(warn).toHaveBeenCalledWith('new releases: could not tag the new releases, trying again next run', { reason: 'lastfm down' });
  });

  it('tagging that failed (a 503 storm) is retried after the retry time without another YouTube run, and then fills the family', async () => {
    const fetchReleases = fetchFake(async (ids) => fetched(ids, { explore: [shelf('x')] }));
    members = [member('m1', [1])];
    let down = true;
    const familiesOf = familiesFake(async (refs, opts) => {
      if (opts.maxLookups === 0) return new Map<string, { family: FamilySlug | null }>();
      // A failed lookup leaves no row, exactly like the real tagger.
      return down ? new Map<string, { family: FamilySlug | null }>() : new Map<string, { family: FamilySlug | null }>(refs.map((r) => [r.name.toLowerCase(), { family: 'pop' as FamilySlug }]));
    });
    const cache = make({ fetchReleases, familiesOf });
    await cache.get();
    await settled(cache);

    const first = await cache.get();
    expect(first.releases.map((r) => r.family)).toEqual([null]);
    expect(first.stale).toBe(true);

    // Inside the retry time nothing is tried again.
    clock += NEW_RELEASES_RETRY_MS - 1000;
    await cache.get();
    await settled(cache);
    const calls = familiesOf.mock.calls.filter(([, o]) => o.maxLookups === FAMILY_LOOKUPS_PER_RUN).length;
    expect(calls).toBe(1);

    down = false;
    clock += 2000;
    await cache.get();
    await settled(cache);
    const done = await cache.get();
    expect(done.releases.map((r) => r.family)).toEqual(['pop']);
    expect(done.stale).toBe(false);
    expect(fetchReleases).toHaveBeenCalledTimes(1);
    expect(readMirrorFile().releases[0].family).toBe('pop');
  });

  it('after a restart a mirror with untagged releases is tagged again', async () => {
    seedMirror({
      refreshedAt: iso(clock - HOUR),
      releases: [{ browseId: 'x', title: 'X', kind: 'album', year: null, artworkUrl: null, artist: 'Shelf', artistId: id(99), family: null, firstSeenAt: iso(clock - HOUR), via: 'explore' }],
    });
    const fetchReleases = fetchFake(async (ids) => fetched(ids));
    const familiesOf = familiesFake(async () => new Map<string, { family: FamilySlug | null }>([['shelf', { family: 'rock-metal' }]]));
    const cache = make({ fetchReleases, familiesOf });
    expect((await cache.get()).stale).toBe(false);
    await settled(cache);
    const got = await cache.get();
    expect(got.releases[0].family).toBe('rock-metal');
    expect(got.stale).toBe(false);
    expect(fetchReleases).not.toHaveBeenCalled();
  });

  it('looks up the members own artists too, a few a run, so their genres exist', async () => {
    members = [member('m1', [1, 2, 3])];
    const familiesOf = familiesFake(async () => new Map<string, { family: FamilySlug | null }>());
    const cache = make({ familiesOf });
    await cache.get();
    await settled(cache);
    expect(familiesOf).toHaveBeenCalledWith(
      [id(1), id(2), id(3)].map((a, i) => ({ name: `A${i + 1}`, artistId: a })),
      { maxLookups: MEMBER_LOOKUPS_PER_RUN },
    );
  });

  it('a run that got only failures is not cached as fresh: nothing is written and it retries', async () => {
    members = [member('m1', [1])];
    const fetchReleases = fetchFake(async () => ({ artists: [], explore: null, failed: [id(1)] }));
    const cache = make({ fetchReleases });
    await cache.get();
    await settled(cache);
    expect(fs.existsSync(file)).toBe(false);
    expect(await cache.get()).toEqual(EMPTY);
    clock += NEW_RELEASES_RETRY_MS;
    await cache.get();
    await settled(cache);
    expect(fetchReleases).toHaveBeenCalledTimes(2);
  });

  it('disabled: no run, ever, and an empty answer', async () => {
    const fetchReleases = fetchFake(async (ids) => fetched(ids, { explore: [shelf('x')] }));
    const loadMemberLikes = vi.fn(async () => members);
    members = [member('m1', [1])];
    seedMirror({ refreshedAt: iso(clock), releases: [] });
    const cache = make({ fetchReleases, loadMemberLikes, disabled: true });

    expect(await cache.get()).toEqual(EMPTY);
    clock += 2 * NEW_RELEASES_TTL_MS;
    expect(await cache.get()).toEqual(EMPTY);
    expect(cache.busy()).toBe(false);
    expect(fetchReleases).not.toHaveBeenCalled();
    expect(loadMemberLikes).not.toHaveBeenCalled();
  });

  it('no likes on the server: an explore-only run', async () => {
    const fetchReleases = fetchFake(async () => ({ artists: [], explore: [shelf('x')], failed: [] }));
    const familiesOf = familiesFake(async () => new Map<string, { family: FamilySlug | null }>());
    members = [];
    const cache = make({ fetchReleases, familiesOf });
    await cache.get();
    await settled(cache);

    expect(fetchReleases).toHaveBeenCalledWith([], { explore: true });
    expect((await cache.get()).releases.map((r) => r.browseId)).toEqual(['x']);
  });
});
