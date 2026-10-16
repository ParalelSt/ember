import { artistKey } from './artistKey';
import { chartDef, classifyTags, type FamilySlug, type RawTag, type SubSlug } from './taxonomy';

/** The artist genre tagger (docs/mixes.md): makes sure the artists a mix
 *  needs have an artist_genres row, looking up the missing and expired ones
 *  (Last.fm first when it has a key, MusicBrainz otherwise), one artist at
 *  a time through the sources' own rate limits. Everything it needs comes
 *  in as deps, so the tests run on saved API responses and an in-memory
 *  store; lib/genres/instance.ts wires the real ones. */

export type GenreSource = 'lastfm' | 'musicbrainz' | 'chart' | 'manual';

export interface ArtistGenre {
  key: string;
  name: string;
  artistId: string | null;
  /** Primary family, null when unknown. */
  family: FamilySlug | null;
  families: Partial<Record<FamilySlug, number>>;
  sub: SubSlug | null;
  tags: RawTag[];
  source: GenreSource;
  status: 'found' | 'none';
  /** ISO time of the last lookup; '' for a chart prior never looked up. */
  fetchedAt: string;
}

export interface GenreStore {
  getMany(keys: readonly string[]): Promise<Map<string, ArtistGenre>>;
  save(row: ArtistGenre): Promise<void>;
}

export interface ArtistRef {
  name: string;
  artistId?: string | null;
}

/** null: the source does not know the artist. Throws on a fault. */
export type TagLookup = (name: string) => Promise<RawTag[] | null>;

export interface TaggerDeps {
  store: GenreStore;
  /** Set only when LASTFM_API_KEY is. */
  lastfm?: TagLookup | null;
  /** Null turns lookups off (GENRES_LOOKUP_DISABLED, tests). */
  musicbrainz?: TagLookup | null;
  now?: () => number;
  warn?: (message: string, detail?: Record<string, unknown>) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** A "none" (and a chart prior already looked up) is asked again after this. */
export const NONE_RETRY_MS = 30 * DAY_MS;
/** A "found" row is refreshed after this. */
export const FOUND_REFRESH_MS = 180 * DAY_MS;

/** Whether a row (or its absence) calls for a lookup now. A manual row
 *  never does: the admin's word stands. */
export function needsLookup(row: ArtistGenre | undefined, now: number): boolean {
  if (!row) return true;
  if (row.source === 'manual') return false;
  const at = Date.parse(row.fetchedAt);
  if (!row.fetchedAt || Number.isNaN(at)) return true;
  const age = now - at;
  if (row.source === 'chart' || row.status === 'none') return age >= NONE_RETRY_MS;
  return age >= FOUND_REFRESH_MS;
}

export function createTagger(deps: TaggerDeps) {
  const now = deps.now ?? Date.now;
  const warn = deps.warn ?? (() => {});
  const inFlight = new Map<string, Promise<ArtistGenre | null>>();

  /** One artist's lookup: Last.fm, then MusicBrainz when Last.fm has no
   *  key, does not know them or says nothing mappable. Null when a source
   *  failed (nothing is written; tomorrow tries again). */
  async function lookup(ref: ArtistRef, key: string, existing: ArtistGenre | undefined): Promise<ArtistGenre | null> {
    const at = new Date(now()).toISOString();
    let tags: RawTag[] | null = null;
    let source: GenreSource | null = null;
    try {
      if (deps.lastfm) {
        const got = await deps.lastfm(ref.name);
        if (got && classifyTags(got).family) {
          tags = got;
          source = 'lastfm';
        } else if (got) {
          tags = got;
        }
      }
      if (!source && deps.musicbrainz) {
        const got = await deps.musicbrainz(ref.name);
        if (got && classifyTags(got).family) {
          tags = got;
          source = 'musicbrainz';
        } else if (got && !tags) {
          tags = got;
        }
      }
    } catch (e) {
      warn('genres: lookup failed, trying again later', { artist: ref.name, reason: e instanceof Error ? e.message : String(e) });
      return null;
    }
    const base = {
      key,
      name: ref.name,
      artistId: ref.artistId ?? existing?.artistId ?? null,
      fetchedAt: at,
    };
    let row: ArtistGenre;
    if (source && tags) {
      const v = classifyTags(tags);
      row = { ...base, family: v.family, families: v.families, sub: v.sub, tags, source, status: 'found' };
    } else if (existing?.source === 'chart' && existing.family) {
      // Nobody knows them, but they are in a genre chart: keep that prior,
      // and do not ask again for a month.
      row = { ...existing, ...base, tags: tags ?? existing.tags };
    } else {
      row = { ...base, family: null, families: {}, sub: null, tags: tags ?? [], source: deps.lastfm ? 'lastfm' : 'musicbrainz', status: 'none' };
    }
    await deps.store.save(row);
    return row;
  }

  function lookupOnce(ref: ArtistRef, key: string, existing: ArtistGenre | undefined): Promise<ArtistGenre | null> {
    const running = inFlight.get(key);
    if (running) return running;
    const p = lookup(ref, key, existing).finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  }

  /** ensureTags, also saying how many lookups it made. */
  async function ensureTagsCounted(refs: readonly ArtistRef[], { maxLookups = Infinity }: { maxLookups?: number } = {}): Promise<{ rows: Map<string, ArtistGenre>; lookups: number }> {
    const unique = new Map<string, ArtistRef>();
    for (const r of refs) {
      const key = artistKey(r.name);
      if (key && !unique.has(key)) unique.set(key, r);
    }
    const rows = await deps.store.getMany([...unique.keys()]);
    const canLookUp = !!(deps.lastfm || deps.musicbrainz);
    let lookups = 0;
    if (!canLookUp) return { rows, lookups };
    for (const [key, ref] of unique) {
      if (lookups >= maxLookups) break;
      const row = rows.get(key);
      if (!needsLookup(row, now())) continue;
      lookups++;
      const got = await lookupOnce(ref, key, row);
      if (got) rows.set(key, got);
    }
    return { rows, lookups };
  }

  /** Every given artist's row, looking up at most `maxLookups` of the
   *  missing or expired ones (in the order given: pass the most important
   *  first; the rest wait for the next run). Lookups run one after another;
   *  the sources pace themselves. */
  async function ensureTags(refs: readonly ArtistRef[], opts: { maxLookups?: number } = {}): Promise<Map<string, ArtistGenre>> {
    return (await ensureTagsCounted(refs, opts)).rows;
  }

  /** Genre chart artists as weak priors: an artist in the Rock chart is
   *  probably rock. Written only for artists with no row at all, so a
   *  lookup or an admin's word is never replaced. The first chart an artist
   *  is seen in (Home order) wins. */
  async function applyChartPriors(charts: readonly { slug: string; tracks: readonly { artist: string; artistId?: string | null }[] }[]): Promise<number> {
    const seen = new Map<string, ArtistGenre>();
    for (const chart of charts) {
      const def = chartDef(chart.slug);
      if (!def) continue;
      for (const t of chart.tracks) {
        const key = artistKey(t.artist);
        if (!key || seen.has(key)) continue;
        seen.set(key, {
          key, name: t.artist, artistId: t.artistId ?? null, family: def.family, families: { [def.family]: 1 },
          sub: def.sub ?? null, tags: [{ name: `chart:${def.slug}`, count: 1 }], source: 'chart', status: 'found', fetchedAt: '',
        });
      }
    }
    if (seen.size === 0) return 0;
    const existing = await deps.store.getMany([...seen.keys()]);
    let written = 0;
    for (const [key, row] of seen) {
      if (existing.has(key)) continue;
      await deps.store.save(row);
      written++;
    }
    return written;
  }

  return { ensureTags, ensureTagsCounted, applyChartPriors };
}

export type Tagger = ReturnType<typeof createTagger>;
