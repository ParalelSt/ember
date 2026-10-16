import { artistKey } from '../genres/artistKey';
import { chartDef, type FamilySlug } from '../genres/taxonomy';
import type { Track } from '../../types/track';
import { assembleMix, describeMix, pickSeeds, type GenreOf } from './build';
import { clusterMember, type MixPlan } from './cluster';
import { scoreArtists, scoreSongs, PLAY_WINDOW_DAYS, type PlayEvent } from './score';
import type { ArtistGenre, ArtistRef } from '../genres/tagger';

/** The genre mix build (docs/mixes.md): for one member, score their plays
 *  and likes, tag their artists, pick the families, fetch radio for a few
 *  seeds of each, tag the new artists, assemble, and store. Nightly for
 *  every member who played something in the last 90 days, and lazily for
 *  one member whose mixes are missing or old. Everything outside comes in
 *  as deps, so tests run on a fake player, a fake tagger and an in-memory
 *  store; lib/mixes/instance.ts wires the real ones. */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Artists of the member tagged before clustering. */
export const TOP_ARTISTS = 60;
/** Lookups a member's build may make in one run; the rest wait a day. */
export const LOOKUPS_PER_MEMBER = 100;
export const RADIO_LIMIT = 30;
/** Rows older than this get a lazy rebuild when the member opens Home. */
export const STALE_AFTER_MS = 36 * 60 * 60 * 1000;
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
  /** Kept as they were: the radio was down or too few songs survived. */
  kept: string[];
  deleted: string[];
}

function toGenreOf(rows: ReadonlyMap<string, ArtistGenre>): Map<string, GenreOf> {
  const out = new Map<string, GenreOf>();
  for (const [k, r] of rows) out.set(k, { family: r.family, sub: r.sub, manual: r.source === 'manual' });
  return out;
}

/** A local calendar day, YYYY-MM-DD: the seeds' daily rotation. */
export function localDay(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function createMixJob(deps: MixJobDeps) {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  const warn = deps.warn ?? (() => {});

  async function buildMember(userId: string): Promise<MemberBuild> {
    const at = now();
    const since = new Date(at - PLAY_WINDOW_DAYS * DAY_MS).toISOString();
    const [plays, likes, stored] = await Promise.all([deps.loadPlays(userId, since), deps.loadLikes(userId), deps.listMixes(userId)]);
    const songs = scoreSongs(plays, likes, at);
    const artists = scoreArtists(songs);
    const result: MemberBuild = { userId, eligible: false, written: [], kept: [], deleted: [] };

    let budget = LOOKUPS_PER_MEMBER;
    const top = artists.slice(0, TOP_ARTISTS).map((a) => ({ name: a.name, artistId: a.artistId }));
    const first = await deps.ensureTags(top, { maxLookups: budget });
    const known = first.rows;
    budget -= first.lookups;
    const cluster = clusterMember(songs, toGenreOf(known));
    result.eligible = cluster.eligible;

    const keep = new Set(cluster.mixes.map((m) => m.key));
    for (const old of stored) {
      if (keep.has(old.key)) continue;
      await deps.deleteMix(old.id);
      result.deleted.push(old.key);
    }
    if (cluster.mixes.length === 0) return result;

    const [charts, unavailable] = await Promise.all([deps.genreCharts().catch(() => []), deps.unavailableIds().catch(() => new Set<string>())]);
    const day = localDay(at);

    // Radio for every mix first, then one tagging pass over every new artist.
    const radios = new Map<string, { seed: string; tracks: Track[] }[] | null>();
    for (const plan of cluster.mixes) {
      const seeds = pickSeeds(plan, day).map((s) => s.track.sourceId);
      try {
        radios.set(plan.key, seeds.length ? (await deps.radioBatch(seeds, RADIO_LIMIT)).radios : []);
      } catch (e) {
        warn('mixes: radio failed, keeping the last mix', { userId, mix: plan.key, reason: e instanceof Error ? e.message : String(e) });
        radios.set(plan.key, null);
      }
    }
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

    const builtAt = new Date(at).toISOString();
    for (const [position, plan] of cluster.mixes.entries()) {
      const list = radios.get(plan.key);
      const tracks = list === null ? null : assembleMix({
        plan,
        radios: list ?? [],
        chartTracks: chartTracksFor(plan, charts),
        genres,
        otherFamilyChartArtists: otherChartArtists(plan.family, charts),
        unavailable,
      });
      if (!tracks) {
        result.kept.push(plan.key);
        continue;
      }
      const meta = describeMix(plan, tracks);
      await deps.saveMix(userId, {
        key: plan.key,
        title: meta.title,
        subtitle: meta.subtitle,
        position,
        tracks,
        seeds: pickSeeds(plan, day).map((s) => s.key),
        cover: { artworkUrls: meta.artworkUrls, color: meta.color },
        builtAt,
      });
      result.written.push(plan.key);
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
    const members = await deps.listActiveMembers(new Date(now() - PLAY_WINDOW_DAYS * DAY_MS).toISOString());
    for (const m of members) enqueue(m);
    await drain();
    return members.length;
  }

  /** The lazy trigger (GET /api/mixes): build this member in the background
   *  when their mixes are missing or older than STALE_AFTER_MS, unless a
   *  build for them ran in the last LAZY_RETRY_MS and made nothing.
   *  Answers whether a build is now queued or running. */
  function requestBuild(userId: string, stored: readonly { builtAt: string }[]): boolean {
    if (isBuilding(userId)) return true;
    const oldest = stored.reduce((min, m) => Math.min(min, Date.parse(m.builtAt) || 0), Infinity);
    const stale = stored.length === 0 || now() - oldest >= STALE_AFTER_MS;
    if (!stale) return false;
    const last = lastLazy.get(userId);
    if (last && now() - last.at < LAZY_RETRY_MS) return false;
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
