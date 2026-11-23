import { songKey } from '../../songKey';
import { artistKey } from '../../genres/artistKey';
import type { FamilySlug } from '../../genres/taxonomy';
import type { Track } from '../../../types/track';
import type { GenreOf } from '../build';
import { pickSeeds } from '../build';
import { clusterMember } from '../cluster';
import { createMixJob, localDay, toGenreOf } from '../job';
import { scoreSongs, type PlayEvent } from '../score';
import { fileDeps, trackOf, type FileDepsOptions, type SimExport } from './fileDeps';
import type { SimMember, SimMix, SimRun, SimTrack } from './types';

/** Rebuilds every active member's mixes from an export with the real mix
 *  job (lib/mixes/job.ts) and explains every song. "Old rules" is simply
 *  this run on the old commit; the explainers below are passed in when the
 *  code under test has them, so the runner works on both. */

export interface Explainers {
  /** lib/genres/songSignal songSignal. */
  signal?: (t: Pick<Track, 'title' | 'artist' | 'album'>) => string | null;
  /** lib/mixes/songFamily resolveGenre. */
  resolve?: (t: Pick<Track, 'title' | 'artist' | 'album'>, genres: ReadonlyMap<string, GenreOf>) => { family: FamilySlug | null; via: string | null };
  /** lib/mixes/untagged untaggedHomes, with the radios of the member's style mixes. */
  homes?: (
    radios: { family: FamilySlug; seed: string; tracks: readonly Track[] }[],
    genres: ReadonlyMap<string, GenreOf>,
    own: readonly Track[],
  ) => ReadonlyMap<string, FamilySlug>;
}

export interface RunOptions extends FileDepsOptions {
  label: string;
  explain?: Explainers;
  /** Only these members (default: every active one). */
  only?: string[];
  progress?: (message: string) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function runMeasure(exp: SimExport, opts: RunOptions): Promise<SimRun> {
  const { deps, capture } = fileDeps(exp, opts);
  const job = createMixJob(deps);
  const explain = opts.explain ?? {};
  const members = (await deps.listActiveMembers(new Date(exp.now - 90 * DAY_MS).toISOString())).filter((m) => !opts.only || opts.only.includes(m));
  const out: SimMember[] = [];
  for (const userId of members) {
    opts.progress?.(`building ${userId}`);
    const r = await job.buildMember(userId);
    const plays = await deps.loadPlays(userId, new Date(exp.now - 90 * DAY_MS).toISOString());
    const likes = await deps.loadLikes(userId);
    const songs = scoreSongs(plays, likes, exp.now);
    const ownKeys = new Set(songs.map((s) => s.key));
    const rows = capture.rows.get(userId) ?? new Map();
    const genres = toGenreOf(rows);
    const cluster = clusterMember(songs, toGenreOf(capture.firstRows.get(userId) ?? new Map()));

    // The radios of the style mixes that were written, by their family.
    const day = localDay(exp.now);
    const styleRadios: { family: FamilySlug; seed: string; tracks: readonly Track[] }[] = [];
    const seenSeed = new Set<string>();
    for (const plan of cluster.mixes) {
      if (!r.written.includes(plan.key) && !r.kept.includes(plan.key)) continue;
      for (const s of pickSeeds(plan, day)) {
        const tracks = capture.radios.get(s.track.sourceId);
        if (!tracks) continue;
        const k = `${plan.family}|${s.track.sourceId}`;
        if (seenSeed.has(k)) continue;
        seenSeed.add(k);
        styleRadios.push({ family: plan.family, seed: s.track.sourceId, tracks });
      }
    }
    const homes = explain.homes ? explain.homes(styleRadios, genres, songs.map((s) => s.track)) : null;

    const describe = (t: Track): SimTrack => {
      const aKey = artistKey(t.artist);
      const row = rows.get(aKey);
      const g = genres.get(aKey);
      const one: SimTrack = {
        id: t.id,
        songKey: songKey(t),
        title: t.title,
        artist: t.artist,
        artistKey: aKey,
        own: ownKeys.has(songKey(t)),
        source: row?.source ?? null,
        family: row?.family ?? null,
        tags: (row?.tags ?? []).slice(0, 4).map((x: { name: string }) => x.name),
        untagged: !g?.family && !g?.manual,
      };
      if (explain.signal) one.signal = explain.signal(t);
      if (explain.resolve) {
        const v = explain.resolve(t, genres);
        one.resolved = v.family;
        one.via = v.via;
      }
      if (homes && one.untagged) one.home = homes.get(aKey) ?? null;
      return one;
    };

    const mixes: SimMix[] = (capture.saved.get(userId) ?? [])
      .map((m) => ({ key: m.key, title: m.title, position: m.position, tracks: m.tracks.map(describe) }))
      .sort((a, b) => a.position - b.position);

    const families: SimMember['families'] = {};
    const unrecognised: SimMember['unrecognised'] = [];
    for (const s of songs) {
      const fam = explain.resolve ? explain.resolve(s.track, genres).family : genres.get(s.artistKey)?.family ?? null;
      if (!fam) {
        const sig = explain.signal?.(s.track) ?? null;
        if (!sig) unrecognised.push({ title: s.track.title, artist: s.track.artist, plays: s.plays });
        continue;
      }
      const f = (families[fam] ??= { weight: 0, songs: 0, artists: 0 });
      f.weight = Math.round((f.weight + s.score) * 100) / 100;
      f.songs++;
    }
    for (const fam of Object.keys(families)) {
      const artists = new Set(songs.filter((s) => (explain.resolve ? explain.resolve(s.track, genres).family : genres.get(s.artistKey)?.family) === fam).map((s) => s.artistKey));
      families[fam].artists = artists.size;
    }

    out.push({
      userId,
      eligible: r.eligible,
      written: r.written,
      kept: r.kept,
      deleted: r.deleted,
      mixes,
      plans: cluster.mixes.map((p) => ({ key: p.key, family: p.family, sub: p.sub, weight: Math.round(p.weight * 100) / 100, songs: p.songs.length, artists: p.artists.length })),
      families,
      unrecognised,
      notes: capture.notes.get(userId) ?? [],
      radioMissing: [...capture.radioMissing].filter((x) => x.startsWith(`${userId}:`)).map((x) => x.slice(userId.length + 1)),
    });
  }
  return { label: opts.label, createdAt: new Date().toISOString(), now: new Date(exp.now).toISOString(), members: out };
}

/** The mixes as the copy holds them (what members see today), explained
 *  with the copy's artist rows only. No rebuild, no network. */
export function storedRun(exp: SimExport, explain: Explainers = {}): SimRun {
  const { genres: rowsList } = exp;
  const byKey = new Map(rowsList.map((r) => [r.artist_key, r]));
  const users = [...new Set(exp.mixes.map((m) => m.user))].sort();
  const members: SimMember[] = users.map((userId) => {
    const plays: PlayEvent[] = exp.plays.filter((p) => p.user === userId).map((p) => ({ track: trackOf(p)!, playedAt: p.played_at })).filter((p) => p.track);
    const ownKeys = new Set(scoreSongs(plays, exp.likes.filter((l) => l.user === userId).map(trackOf).filter((t): t is Track => !!t), exp.now).map((s) => s.key));
    const mixes = exp.mixes.filter((m) => m.user === userId).map((m) => ({
      key: m.key,
      title: m.title,
      position: m.position,
      tracks: m.tracks.map((t): SimTrack => {
        const aKey = artistKey(t.artist);
        const row = byKey.get(aKey);
        const one: SimTrack = {
          id: t.id, songKey: songKey(t), title: t.title, artist: t.artist, artistKey: aKey, own: ownKeys.has(songKey(t)),
          source: row?.source ?? null, family: row?.family || null, tags: (row?.tags ?? []).slice(0, 4).map((x) => x.name),
          untagged: !row?.family && row?.source !== 'manual',
        };
        if (explain.signal) one.signal = explain.signal(t);
        return one;
      }),
    }));
    return { userId, eligible: true, written: mixes.map((m) => m.key), kept: [], deleted: [], mixes, plans: [], families: {}, unrecognised: [], notes: [], radioMissing: [] };
  });
  return { label: 'stored', createdAt: new Date().toISOString(), now: new Date(exp.now).toISOString(), members };
}
