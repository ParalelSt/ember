import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mapTrackRow, type TrackRecord } from '../../mapTrack';
import { fromRecord, toRecord, type ArtistGenreRecord } from '../../genres/store';
import { classifyTags } from '../../genres/taxonomy';
import { createTagger, type ArtistGenre, type GenreStore, type TagLookup } from '../../genres/tagger';
import type { Track } from '../../../types/track';
import type { MixJobDeps, MixRow } from '../job';
import type { PlayEvent } from '../score';

/** The mix job's deps backed by a JSON export of a PocketBase copy
 *  (tests/measure-mixes/snapshot.sh), for the mix measurement. Nothing here
 *  writes to the export: tags the simulated tagger looks up go to
 *  tags-overlay.json, radios to radios.json, both in the export's folder,
 *  so a rerun replays them without the network. */

type Row = Record<string, unknown>;

export interface SimExport {
  dir: string;
  now: number;
  plays: (Row & { user: string; played_at: string })[];
  likes: (Row & { user: string })[];
  blocked: (Row & { user: string })[];
  genres: ArtistGenreRecord[];
  mixes: { id: string; user: string; key: string; title: string; position: number; tracks: Track[]; seeds: string[]; built_at: string }[];
  unavailable: string[];
  members: string[];
  charts: { slug: string; tracks: Track[] }[];
}

const readJson = <T>(file: string, fallback: T): T => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback);
const parseMaybe = (v: unknown) => (typeof v === 'string' && v ? JSON.parse(v) : v ?? null);
const pbTime = (s: string) => Date.parse(String(s ?? '').replace(' ', 'T'));

export function loadExport(dir: string): SimExport {
  const at = (f: string) => path.join(dir, f);
  const meta = readJson<{ now: string }>(at('meta.json'), { now: '' });
  const genres = readJson<Row[]>(at('artist_genres.json'), []).map((r) => ({
    ...(r as unknown as ArtistGenreRecord),
    families: parseMaybe(r.families),
    tags: parseMaybe(r.tags),
  }));
  const mixes = readJson<Row[]>(at('mixes.json'), []).map((r) => ({
    id: String(r.id),
    user: String(r.user),
    key: String(r.key),
    title: String(r.title),
    position: Number(r.position) || 0,
    tracks: (parseMaybe(r.tracks) ?? []) as Track[],
    seeds: (parseMaybe(r.seeds) ?? []) as string[],
    built_at: String(r.built_at),
  }));
  const charts = readJson<{ charts?: { slug: string; tracks: Track[] }[] }>(at('charts.json'), {}).charts ?? [];
  return {
    dir,
    now: pbTime(meta.now),
    plays: readJson(at('plays.json'), []),
    likes: readJson(at('likes.json'), []),
    blocked: readJson(at('blocked.json'), []),
    genres,
    mixes,
    unavailable: readJson<{ external_id: string }[]>(at('unavailable.json'), []).map((r) => r.external_id),
    members: readJson<{ id: string }[]>(at('members.json'), []).map((r) => r.id),
    charts: charts.map((c) => ({ slug: c.slug, tracks: c.tracks ?? [] })),
  };
}

export const trackOf = (r: Row): Track | null => mapTrackRow(r as unknown as TrackRecord);

export type RadioFetch = (seeds: string[], limit: number) => Promise<{ radios: { seed: string; tracks: Track[] }[]; failed: string[] }>;

export interface FileDepsOptions {
  /** Fetches a seed missing from radios.json (then cached). Absent: such a
   *  seed counts as failed and is listed in `radioMissing`. */
  fetchRadio?: RadioFetch | null;
  /** Tag lookups for artists the copy lacks or holds expired rows for. */
  lastfm?: TagLookup | null;
  musicbrainz?: TagLookup | null;
  warn?: (message: string, detail?: Record<string, unknown>) => void;
}

export interface SimCapture {
  saved: Map<string, MixRow[]>;
  deleted: Map<string, string[]>;
  notes: Map<string, { message: string; detail?: Record<string, unknown> }[]>;
  radioMissing: Set<string>;
  /** Every artist row a member's build was handed, by member. */
  rows: Map<string, Map<string, ArtistGenre>>;
  /** The rows of a member's first tagging pass (their own artists), which the cluster reads. */
  firstRows: Map<string, Map<string, ArtistGenre>>;
  radios: Map<string, Track[] | null>;
}

/** A row the simulated tagger wrote is read as the code under test would
 *  have written it (its family classified from its tags again), so old and
 *  new rules each see their own reading of the same lookups. */
function asLookedUp(r: ArtistGenreRecord): ArtistGenreRecord {
  if ((r.source !== 'lastfm' && r.source !== 'musicbrainz') || !Array.isArray(r.tags) || r.tags.length === 0) return r;
  const v = classifyTags(r.tags);
  return { ...r, family: v.family ?? '', families: v.families, sub: v.sub ?? '', status: v.family ? 'found' : 'none' };
}

export function fileDeps(exp: SimExport, opts: FileDepsOptions = {}) {
  const overlayFile = path.join(exp.dir, 'tags-overlay.json');
  const radiosFile = path.join(exp.dir, 'radios.json');
  const base = new Map(exp.genres.map((r) => [r.artist_key, r]));
  const overlay = new Map<string, ArtistGenreRecord>(Object.entries(readJson<Record<string, ArtistGenreRecord>>(overlayFile, {})));
  const radioCache = new Map<string, Track[] | null>(Object.entries(readJson<Record<string, Track[] | null>>(radiosFile, {})));
  const capture: SimCapture = { saved: new Map(), deleted: new Map(), notes: new Map(), radioMissing: new Set(), rows: new Map(), firstRows: new Map(), radios: radioCache };
  let current = '';

  const store: GenreStore = {
    async getMany(keys) {
      const out = new Map<string, ArtistGenre>();
      for (const k of keys) {
        const o = overlay.get(k);
        const r = o ? asLookedUp(o) : base.get(k);
        if (r) out.set(k, fromRecord(r));
      }
      return out;
    },
    async save(row) {
      overlay.set(row.key, toRecord(row));
      writeFileSync(overlayFile, JSON.stringify(Object.fromEntries(overlay)));
    },
  };
  const tagger = createTagger({ store, lastfm: opts.lastfm ?? null, musicbrainz: opts.musicbrainz ?? null, now: () => exp.now, warn: opts.warn });

  const userTracks = (rows: (Row & { user: string })[], userId: string) =>
    rows.filter((r) => r.user === userId).map(trackOf).filter((t): t is Track => !!t);
  const unavailable = new Set(exp.unavailable);
  const stored = new Map<string, { id: string; key: string; builtAt: string }[]>();
  for (const m of exp.mixes) {
    const list = stored.get(m.user) ?? [];
    list.push({ id: m.id, key: m.key, builtAt: m.built_at });
    stored.set(m.user, list);
  }

  const deps: MixJobDeps = {
    async listActiveMembers(sinceIso) {
      const since = Date.parse(sinceIso);
      const active = new Set(exp.plays.filter((p) => pbTime(p.played_at) >= since).map((p) => p.user));
      return [...new Set(exp.plays.map((p) => p.user))].filter((u) => active.has(u)).sort();
    },
    async loadPlays(userId, sinceIso) {
      current = userId;
      const since = Date.parse(sinceIso);
      const out: PlayEvent[] = [];
      for (const p of exp.plays) {
        if (p.user !== userId || pbTime(p.played_at) < since) continue;
        const track = trackOf(p);
        if (track) out.push({ track, playedAt: p.played_at });
      }
      return out;
    },
    loadLikes: async (userId) => userTracks(exp.likes, userId),
    loadBlocked: async (userId) => userTracks(exp.blocked, userId),
    async ensureTags(refs, o) {
      const got = await tagger.ensureTagsCounted(refs, o);
      if (!capture.firstRows.has(current)) capture.firstRows.set(current, new Map(got.rows));
      const mine = capture.rows.get(current) ?? new Map<string, ArtistGenre>();
      for (const [k, v] of got.rows) mine.set(k, v);
      capture.rows.set(current, mine);
      return got;
    },
    async radioBatch(seeds, limit) {
      const missing = seeds.filter((s) => !radioCache.has(s));
      if (missing.length && opts.fetchRadio) {
        let got: Awaited<ReturnType<RadioFetch>> = { radios: [], failed: missing };
        try {
          got = await opts.fetchRadio(missing, limit);
        } catch {
          // Every seed failed: each is remembered as failed.
        }
        for (const r of got.radios) radioCache.set(r.seed, r.tracks);
        for (const s of missing) if (!radioCache.has(s)) radioCache.set(s, null);
        writeFileSync(radiosFile, JSON.stringify(Object.fromEntries(radioCache)));
      }
      const radios: { seed: string; tracks: Track[] }[] = [];
      const failed: string[] = [];
      for (const s of seeds) {
        const r = radioCache.get(s);
        if (r) radios.push({ seed: s, tracks: r });
        else {
          failed.push(s);
          if (!radioCache.has(s)) capture.radioMissing.add(`${current}:${s}`);
        }
      }
      if (seeds.length && radios.length === 0) throw new Error('every seed failed');
      return { radios, failed };
    },
    genreCharts: async () => exp.charts,
    unavailableIds: async () => unavailable,
    listMixes: async (userId) => stored.get(userId) ?? [],
    async saveMix(userId, row) {
      const list = capture.saved.get(userId) ?? [];
      list.push(row);
      capture.saved.set(userId, list);
    },
    async deleteMix(id) {
      const m = exp.mixes.find((x) => x.id === id);
      if (!m) return;
      const list = capture.deleted.get(m.user) ?? [];
      list.push(m.key);
      capture.deleted.set(m.user, list);
    },
    now: () => exp.now,
    log: (message, detail) => {
      if (message === 'mixes: built') return;
      const list = capture.notes.get(current) ?? [];
      list.push({ message, detail });
      capture.notes.set(current, list);
    },
    warn: (message, detail) => {
      const list = capture.notes.get(current) ?? [];
      list.push({ message, detail });
      capture.notes.set(current, list);
    },
  };
  return { deps, capture, tagger };
}
