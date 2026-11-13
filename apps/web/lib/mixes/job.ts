import { artistKey } from '../genres/artistKey';
import { chartDef, familyOf, subOfTags, type FamilySlug } from '../genres/taxonomy';
import { exclusionKeys, isExcluded } from '../trackIdentity';
import type { Track } from '../../types/track';
import { assembleMix, describeMix, describeTracks, pickSeeds, type GenreOf, type MixMeta } from './build';
import { clusterMember, type MixPlan } from './cluster';
import { scoreArtists, scoreSongs, type PlayEvent } from './score';
import { ARTIST_SEEDS, artistPlans, assembleArtistMix, describeArtistMix, type ArtistPlan } from './artist';
import { assembleDiscover, describeDiscover, discoverSeeds, weekKey } from './discover';
import { HISTORY_DAYS, onRepeatMix, songHistory, throwbackMix, type HistoryMix } from './history';
import { artistTint, DISCOVER_KEY, FIXED_TITLE, KIND_CAPS, KIND_TINT, lineup, mixKind, mixPosition, ON_REPEAT_KEY, THROWBACK_KEY } from './kinds';
import type { ArtistGenre, ArtistRef } from '../genres/tagger';

/** The personal mix build (docs/mixes.md): for one member, score their
 *  plays and likes, tag their artists, pick up to twelve mixes of five
 *  kinds (style, Discover, On repeat, artist, Throwback), fetch radio for
 *  the ones that need it, tag the new artists, assemble, and store.
 *  Nightly for every member who played something in the last 90 days, and
 *  lazily for one member whose mixes are missing or old. Everything outside
 *  comes in as deps, so tests run on a fake player, a fake tagger and an
 *  in-memory store; lib/mixes/instance.ts wires the real ones. */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Members with a play this recent get the nightly build. */
export const ACTIVE_DAYS = 90;
/** Artists of the member tagged before clustering. */
export const TOP_ARTISTS = 60;
/** Lookups a member's build may make in one run; the rest wait a day. */
export const LOOKUPS_PER_MEMBER = 100;
export const RADIO_LIMIT = 30;
/** Rows older than this get a lazy rebuild when the member opens Home. */
export const STALE_AFTER_MS = 36 * 60 * 60 * 1000;
/** Discover is rebuilt weekly: its row only counts as stale past this. */
export const WEEKLY_STALE_AFTER_MS = 8 * DAY_MS;
/** After a lazy build that found nothing to make, wait this long before
 *  trying that member again. */
export const LAZY_RETRY_MS = 6 * 60 * 60 * 1000;

export interface StoredMix {
  id: string;
  key: string;
  builtAt: string;
}

export interface MixRow {
  key: string;
  title: string;
  subtitle: string;
  position: number;
  tracks: Track[];
  seeds: string[];
  cover: { artworkUrls: string[]; color: string };
  builtAt: string;
}

export interface MixJobDeps {
  /** Members with a play since `sinceIso`. */
  listActiveMembers(sinceIso: string): Promise<string[]>;
  loadPlays(userId: string, sinceIso: string): Promise<PlayEvent[]>;
  loadLikes(userId: string): Promise<Track[]>;
  /** The member's blocked songs (kept out of every mix). */
  loadBlocked?(userId: string): Promise<Track[]>;
  /** The tagger's ensureTagsCounted. */
  ensureTags(refs: readonly ArtistRef[], opts: { maxLookups: number }): Promise<{ rows: Map<string, ArtistGenre>; lookups: number }>;
  /** Throws when every seed failed (a YouTube outage). */
  radioBatch(seeds: string[], limit: number): Promise<{ radios: { seed: string; tracks: Track[] }[]; failed: string[] }>;
  /** The genre charts' lists (cached, may be empty). */
  genreCharts(): Promise<{ slug: string; tracks: Track[] }[]>;
  unavailableIds(): Promise<Set<string>>;
  listMixes(userId: string): Promise<StoredMix[]>;
  saveMix(userId: string, row: MixRow): Promise<void>;
  deleteMix(id: string): Promise<void>;
  now?: () => number;
  log?: (message: string, detail?: Record<string, unknown>) => void;
  warn?: (message: string, detail?: Record<string, unknown>) => void;
}

export interface MemberBuild {
  userId: string;
  eligible: boolean;
  written: string[];
  /** Kept as they were: the radio was down, too few songs survived, or
   *  (Discover) it was already built this week. */
  kept: string[];
  deleted: string[];
}

/** Artist genres as the mixes read them. A looked-up artist's sub-genre is
 *  read again from their stored tags, so a sub-genre added to the taxonomy
 *  applies without looking anyone up again. */
function toGenreOf(rows: ReadonlyMap<string, ArtistGenre>): Map<string, GenreOf> {
  const out = new Map<string, GenreOf>();
  for (const [k, r] of rows) {
    const fromTags = r.source === 'lastfm' || r.source === 'musicbrainz';
    out.set(k, { family: r.family, sub: fromTags ? subOfTags(r.family, r.tags) : r.sub, manual: r.source === 'manual' });
  }
  return out;
}

/** A local calendar day, YYYY-MM-DD: the seeds' daily rotation. */
export function localDay(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** One planned mix of the lineup. */
type Planned =
  | { kind: 'style'; key: string; plan: MixPlan; seeds: string[] }
  | { kind: 'artist'; key: string; plan: ArtistPlan; seeds: string[] }
  | { kind: 'discover'; key: string; seeds: string[]; songKeys: string[]; keepAsIs: boolean }
  | { kind: 'on-repeat' | 'throwback'; key: string; mix: HistoryMix };

export function createMixJob(deps: MixJobDeps) {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  const warn = deps.warn ?? (() => {});

  async function buildMember(userId: string): Promise<MemberBuild> {
    const at = now();
    const since = new Date(at - HISTORY_DAYS * DAY_MS).toISOString();
    const [plays, likes, stored, blockedTracks] = await Promise.all([
      deps.loadPlays(userId, since),
      deps.loadLikes(userId),
      deps.listMixes(userId),
      deps.loadBlocked ? deps.loadBlocked(userId).catch(() => [] as Track[]) : Promise.resolve([] as Track[]),
    ]);
    const songs = scoreSongs(plays, likes, at);
    const artists = scoreArtists(songs);
    const history = songHistory(plays, likes, at);
    const blockedKeys = new Set(exclusionKeys(blockedTracks));
    const skip = (t: Track) => isExcluded(t, blockedKeys);
    const result: MemberBuild = { userId, eligible: false, written: [], kept: [], deleted: [] };

    let budget = LOOKUPS_PER_MEMBER;
    const top = artists.slice(0, TOP_ARTISTS).map((a) => ({ name: a.name, artistId: a.artistId }));
    const first = await deps.ensureTags(top, { maxLookups: budget });
    const known = first.rows;
    budget -= first.lookups;
    const knownGenres = toGenreOf(known);
    const cluster = clusterMember(songs, knownGenres);
    const [charts, unavailable] = await Promise.all([deps.genreCharts().catch(() => []), deps.unavailableIds().catch(() => new Set<string>())]);
    const day = localDay(at);
    const week = weekKey(at);

    // The candidates of every kind, then the lineup (caps and order).
    const style: Planned[] = cluster.mixes.map((plan) => ({ kind: 'style', key: plan.key, plan, seeds: pickSeeds(plan, day).map((s) => s.track.sourceId) }));
    const artistMixes: Planned[] = cluster.eligible
      ? artistPlans(artists, knownGenres, KIND_CAPS.artist.max).map((plan) => ({
        kind: 'artist', key: plan.key, plan, seeds: pickSeeds({ key: plan.key, songs: plan.songs }, day, ARTIST_SEEDS).map((s) => s.track.sourceId),
      }))
      : [];
    const discover: Planned[] = [];
    if (cluster.eligible) {
      const old = stored.find((m) => m.key === DISCOVER_KEY);
      const keepAsIs = !!old && weekKey(Date.parse(old.builtAt) || 0) === week;
      const seeds = discoverSeeds(artists, week);
      if (keepAsIs || seeds.length) discover.push({ kind: 'discover', key: DISCOVER_KEY, seeds: seeds.map((s) => s.track.sourceId), songKeys: seeds.map((s) => s.key), keepAsIs });
    }
    const repeat = onRepeatMix(history, unavailable, skip);
    const back = throwbackMix(history, unavailable, skip);
    const picked = lineup<Planned>({
      style,
      discover,
      'on-repeat': repeat ? [{ kind: 'on-repeat', key: ON_REPEAT_KEY, mix: repeat }] : [],
      artist: artistMixes,
      throwback: back ? [{ kind: 'throwback', key: THROWBACK_KEY, mix: back }] : [],
    });
    result.eligible = cluster.eligible || picked.length > 0;

    const keep = new Set(picked.map((p) => p.item.key));
    for (const old of stored) {
      if (keep.has(old.key)) continue;
      await deps.deleteMix(old.id);
      result.deleted.push(old.key);
    }
    if (picked.length === 0) return result;

    // Radio for every mix that needs it, one call per mix, each seed
    // fetched once per build (an artist mix and Discover often share one).
    const radioCache = new Map<string, Track[] | null>();
    async function radiosFor(key: string, seeds: string[]): Promise<{ seed: string; tracks: Track[] }[] | null> {
      const missing = seeds.filter((s) => !radioCache.has(s));
      if (missing.length) {
        try {
          const got = await deps.radioBatch(missing, RADIO_LIMIT);
          for (const r of got.radios) radioCache.set(r.seed, r.tracks);
        } catch (e) {
          if (!seeds.some((s) => radioCache.get(s))) {
            warn('mixes: radio failed, keeping the last mix', { userId, mix: key, reason: e instanceof Error ? e.message : String(e) });
          }
        }
        for (const s of missing) if (!radioCache.has(s)) radioCache.set(s, null);
      }
      const radios = seeds.filter((s) => radioCache.get(s)).map((s) => ({ seed: s, tracks: radioCache.get(s)! }));
      return seeds.length && radios.length === 0 ? null : radios;
    }
    const radios = new Map<string, { seed: string; tracks: Track[] }[] | null>();
    for (const { item } of picked) {
      if (item.kind === 'style' || item.kind === 'artist' || (item.kind === 'discover' && !item.keepAsIs)) {
        radios.set(item.key, await radiosFor(item.key, item.seeds));
      }
    }

    // One tagging pass over every new radio artist (style mixes first).
    const newcomers: ArtistRef[] = [];
    const seen = new Set(known.keys());
    for (const list of radios.values()) {
      for (const r of list ?? []) {
        for (const t of r.tracks) {
          const k = artistKey(t.artist);
          if (!k || seen.has(k)) continue;
          seen.add(k);
          newcomers.push({ name: t.artist, artistId: t.artistId });
        }
      }
    }
    const all = new Map(known);
    if (newcomers.length && budget > 0) {
      for (const [k, v] of (await deps.ensureTags(newcomers, { maxLookups: budget })).rows) all.set(k, v);
    }
    const genres = toGenreOf(all);
    const heard = new Set(history.keys());
    const knownArtists = new Set([...history.values()].map((h) => h.artistKey));

    const builtAt = new Date(at).toISOString();
    for (const { kind, item, index } of picked) {
      let tracks: Track[] | null = null;
      let meta: MixMeta | null = null;
      let seeds: string[] = [];
      if (item.kind === 'style') {
        const list = radios.get(item.key);
        tracks = list === null ? null : assembleMix({
          plan: item.plan,
          radios: list ?? [],
          chartTracks: chartTracksFor(item.plan, charts),
          genres,
          otherFamilyChartArtists: otherChartArtists(item.plan.family, charts),
          unavailable,
          skip,
        });
        if (tracks) meta = describeMix(item.plan, tracks);
        seeds = pickSeeds(item.plan, day).map((s) => s.key);
      } else if (item.kind === 'artist') {
        const list = radios.get(item.key);
        tracks = list === null ? null : assembleArtistMix({ plan: item.plan, radios: list ?? [], genres, unavailable, skip });
        const tint = artistTint(item.key, item.plan.family ? familyOf(item.plan.family)?.tint ?? null : null);
        if (tracks) meta = describeArtistMix(item.plan, tracks, tint);
        seeds = pickSeeds({ key: item.key, songs: item.plan.songs }, day, ARTIST_SEEDS).map((s) => s.key);
      } else if (item.kind === 'discover') {
        if (!item.keepAsIs) {
          const list = radios.get(item.key);
          tracks = list === null ? null : assembleDiscover({ radios: list ?? [], heard, knownArtists, unavailable, skip });
          if (tracks) meta = describeDiscover(tracks);
          seeds = item.songKeys;
        }
      } else {
        tracks = item.mix.tracks;
        meta = describeTracks(FIXED_TITLE[item.kind]!, tracks, KIND_TINT[item.kind]!);
      }
      if (!tracks || !meta) {
        result.kept.push(item.key);
        continue;
      }
      await deps.saveMix(userId, {
        key: item.key,
        title: meta.title,
        subtitle: meta.subtitle,
        position: mixPosition(kind, index),
        tracks,
        seeds,
        cover: { artworkUrls: meta.artworkUrls, color: meta.color },
        builtAt,
      });
      result.written.push(item.key);
    }
    log('mixes: built', { userId, written: result.written, kept: result.kept, deleted: result.deleted });
    return result;
  }

  // One build at a time per process; a member queued twice is built once.
  const queue: string[] = [];
  const queued = new Set<string>();
  const lastLazy = new Map<string, { at: number; eligible: boolean; wrote: boolean }>();
  let running: string | null = null;
  let draining: Promise<void> | null = null;

  function drain(): Promise<void> {
    if (draining) return draining;
    draining = (async () => {
      while (queue.length) {
        const userId = queue.shift()!;
        queued.delete(userId);
        running = userId;
        try {
          const r = await buildMember(userId);
          lastLazy.set(userId, { at: now(), eligible: r.eligible, wrote: r.written.length > 0 });
        } catch (e) {
          warn('mixes: build failed', { userId, reason: e instanceof Error ? e.message : String(e) });
          lastLazy.set(userId, { at: now(), eligible: true, wrote: false });
        } finally {
          running = null;
        }
      }
    })().finally(() => { draining = null; });
    return draining;
  }

  function enqueue(userId: string): void {
    if (running === userId || queued.has(userId)) return;
    queue.push(userId);
    queued.add(userId);
  }

  /** Every member who played something lately, one after another. */
  async function runAll(): Promise<number> {
    const members = await deps.listActiveMembers(new Date(now() - ACTIVE_DAYS * DAY_MS).toISOString());
    for (const m of members) enqueue(m);
    await drain();
    return members.length;
  }

  /** The lazy trigger (GET /api/mixes): build this member in the background
   *  when their mixes are missing or older than STALE_AFTER_MS (Discover:
   *  WEEKLY_STALE_AFTER_MS), unless a
   *  build for them ran in the last LAZY_RETRY_MS and made nothing.
   *  Answers whether a build is now queued or running. */
  function requestBuild(userId: string, stored: readonly { builtAt: string; key?: string }[]): boolean {
    if (isBuilding(userId)) return true;
    const at = now();
    // Discover is rebuilt weekly: it only counts once past a week and a day.
    const stale = stored.length === 0 || stored.some((m) => {
      const age = at - (Date.parse(m.builtAt) || 0);
      return m.key && mixKind(m.key) === 'discover' ? age >= WEEKLY_STALE_AFTER_MS : age >= STALE_AFTER_MS;
    });
    if (!stale) return false;
    const last = lastLazy.get(userId);
    if (last && at - last.at < LAZY_RETRY_MS) return false;
    enqueue(userId);
    void drain();
    return true;
  }

  function isBuilding(userId: string): boolean {
    return running === userId || queued.has(userId);
  }

  /** What the last build in this process found, if any. */
  function lastResult(userId: string): { eligible: boolean } | null {
    const r = lastLazy.get(userId);
    return r ? { eligible: r.eligible } : null;
  }

  return { buildMember, runAll, requestBuild, isBuilding, lastResult, idle: () => draining ?? Promise.resolve() };
}

export type MixJob = ReturnType<typeof createMixJob>;

/** The filler for a mix: its family's genre charts (for a split mix, the
 *  chart of its half first). */
export function chartTracksFor(plan: Pick<MixPlan, 'family' | 'sub'>, charts: readonly { slug: string; tracks: Track[] }[]): Track[] {
  const mine = charts.filter((c) => chartDef(c.slug)?.family === plan.family);
  mine.sort((a, b) => Number(chartDef(b.slug)?.sub === plan.sub) - Number(chartDef(a.slug)?.sub === plan.sub));
  return mine.flatMap((c) => c.tracks);
}

/** Artist keys listed in a genre chart of any other family. */
export function otherChartArtists(family: FamilySlug, charts: readonly { slug: string; tracks: Track[] }[]): Set<string> {
  const out = new Set<string>();
  for (const c of charts) {
    const def = chartDef(c.slug);
    if (!def || def.family === family) continue;
    for (const t of c.tracks) out.add(artistKey(t.artist));
  }
  return out;
}
