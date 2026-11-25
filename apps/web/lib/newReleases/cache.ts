import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { artistKey } from '../genres/artistKey';
import type { FamilySlug } from '../genres/taxonomy';
import type { NewReleasesFetch } from '../sources/youtube';
import {
  applyRun,
  buildWatchlist,
  emptyLedger,
  genreWatchlist,
  isNew,
  likedArtists,
  memberFamilies,
  pickDue,
  type Ledger,
  type LikeRow,
  type LikedArtist,
  type NewReleasesAnswer,
  type Release,
} from './rules';

/** The "New releases" ledger, cached per server like the genre charts
 *  (lib/charts.ts, docs/new-releases-plan.md). Server-wide and keyed by
 *  artist: an artist's page is the same for everyone, so two members who
 *  like the same artist cost one call, and the row itself is picked per
 *  member at request time by the pure rules in ./rules.ts.
 *
 *  One run is one paced player run (the explore shelf plus up to
 *  SCANS_PER_RUN artist pages, about a minute), so unlike the charts a read
 *  never waits for it: it answers from memory and, when the ledger is
 *  missing or a day old, starts the run in the background. A cold start
 *  therefore answers an empty list. Memory is mirrored to
 *  MUSIC_DIR/new-releases.json so a restart serves the ledger at once.
 *
 *  A run steps aside while the charts are refreshing (never two paced runs
 *  together) and is tried again after NEW_RELEASES_RETRY_MS. A failed run
 *  changes nothing: the row keeps what it had, marked stale, until those
 *  releases age out. Releases still without a family because the tagger
 *  failed (a rate limit, say) also mark the ledger stale and are tagged
 *  again after NEW_RELEASES_RETRY_MS, without another YouTube run. */

export const NEW_RELEASES_TTL_MS = 24 * 60 * 60 * 1000;
export const NEW_RELEASES_RETRY_MS = 5 * 60 * 1000;
/** Artist lookups one run may spend on tagging its new releases. They go to
 *  Last.fm and MusicBrainz at their own limits, never to YouTube. */
export const FAMILY_LOOKUPS_PER_RUN = 25;
/** Lookups one run may spend on the members' own liked artists, so their
 *  genres exist for the "similar" part of the row (the route only reads). */
export const MEMBER_LOOKUPS_PER_RUN = 10;

/** One member's like rows, as narrow as the rules need them. */
export interface MemberLikes {
  id: string;
  likes: LikeRow[];
}

interface ArtistRef {
  name: string;
  artistId?: string | null;
}

/** What a read answers: the shared ledger's live releases, for
 *  selectForMember to turn into one member's row. */
export interface NewReleasesState {
  /** ISO time of the last run that brought anything back. */
  refreshedAt: string | null;
  /** The ledger is past the TTL (the source could not refresh it yet). */
  stale: boolean;
  releases: Release[];
  /** Each scanned artist's newest recent release (a first look at an artist). */
  recent: Release[];
}

interface Deps {
  /** The paced player run: the artists' pages plus the explore shelf. */
  fetchReleases: (artistIds: string[], opts: { explore: boolean }) => Promise<NewReleasesFetch>;
  /** Every member's likes, so the watchlist covers the whole server. */
  loadMemberLikes: () => Promise<MemberLikes[]>;
  /** The genre charts, read (not fetched) from their own cache. */
  genreCharts: () => Promise<{ slug: string; tracks: readonly { artistId: string | null }[] }[]>;
  /** True while the charts' own paced run is in flight. */
  chartsBusy: () => boolean;
  /** The genre tagger: artist_genres rows by artist key. */
  familiesOf: (refs: readonly ArtistRef[], opts: { maxLookups: number }) => Promise<Map<string, { family: FamilySlug | null }>>;
  /** Mirror file; null keeps the ledger in memory only. */
  cacheFile: string | null;
  now?: () => number;
  ttlMs?: number;
  retryMs?: number;
  warn?: (message: string, detail?: Record<string, unknown>) => void;
  /** NEW_RELEASES_DISABLED: no run, ever, and an empty answer. */
  disabled?: boolean;
}

function readMirror(file: string | null): Ledger | null {
  if (!file) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as Ledger;
    if (data?.version !== 1 || !Array.isArray(data.releases) || !Array.isArray(data.retired)) return null;
    if (!data.artists || typeof data.artists !== 'object') return null;
    const artists: Ledger['artists'] = {};
    for (const [id, a] of Object.entries(data.artists)) {
      if (!a || typeof a.checkedAt !== 'string' || !Array.isArray(a.known)) continue;
      artists[id] = { name: String(a.name ?? ''), checkedAt: a.checkedAt, scannedAt: a.scannedAt ?? null, known: a.known, latest: a.latest && typeof a.latest.browseId === 'string' ? a.latest : null };
    }
    const releases = data.releases.filter((r) => r && typeof r.browseId === 'string' && typeof r.firstSeenAt === 'string');
    return {
      version: 1,
      refreshedAt: typeof data.refreshedAt === 'string' ? data.refreshedAt : null,
      artists,
      releases,
      retired: data.retired.filter((id): id is string => typeof id === 'string'),
    };
  } catch {
    return null;
  }
}

function writeMirror(file: string | null, ledger: Ledger) {
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(ledger));
    fs.renameSync(tmp, file);
  } catch {
    // The memory copy still works; the mirror only helps after a restart.
  }
}

/** The player's answer in the shape applyRun folds. `kind` is already lower
 *  case, which is what kindOf reads. */
function toAnswer(got: NewReleasesFetch): NewReleasesAnswer {
  return {
    artists: got.artists.map((a) => ({
      id: a.id,
      name: a.name,
      releases: a.releases.map((r) => ({ browseId: r.browseId, title: r.title, year: r.year, type: r.kind, artworkUrl: r.artworkUrl })),
    })),
    explore:
      got.explore?.map((r) => ({
        browseId: r.browseId,
        title: r.title,
        type: r.kind,
        artist: r.artist,
        artistId: r.artistId,
        artworkUrl: r.artworkUrl,
      })) ?? null,
    failed: got.failed,
  };
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createNewReleasesCache(deps: Deps) {
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? NEW_RELEASES_TTL_MS;
  const retryMs = deps.retryMs ?? NEW_RELEASES_RETRY_MS;
  const warn = deps.warn ?? (() => {});

  let ledger: Ledger | null = null;
  let loaded = false;
  let inFlight: Promise<Ledger | null> | null = null;
  let lastFailure = -Infinity;
  /** Some release has no family only because tagging failed or ran out of
   *  lookups: the ledger is stale until a later pass tags it. */
  let tagPending = false;
  let lastTagTry = -Infinity;
  let tagUnchecked = false;

  /** The families some member listens to, from stored artist_genres rows
   *  only (maxLookups: 0, so no run ever waits on Last.fm for this). */
  async function wantedFamilies(members: readonly { id: string; artists: LikedArtist[] }[]): Promise<FamilySlug[]> {
    const all = members.flatMap((m) => m.artists);
    if (all.length === 0) return [];
    let rows: Map<string, { family: FamilySlug | null }>;
    try {
      rows = await deps.familiesOf(all.map((a) => ({ name: a.name, artistId: a.artistId })), { maxLookups: 0 });
    } catch (e) {
      warn('new releases: could not read the members genres, scanning liked artists only', { reason: reason(e) });
      return [];
    }
    const out: FamilySlug[] = [];
    for (const m of members) {
      for (const f of memberFamilies(m.artists, (a) => rows.get(artistKey(a.name))?.family ?? null)) {
        if (!out.includes(f)) out.push(f);
      }
    }
    return out;
  }

  /** Gives the run's new releases a family, so they can be suggested. At
   *  most FAMILY_LOOKUPS_PER_RUN lookups, the newest releases first; the
   *  rest wait for the next run. A tagger that is down costs nothing. */
  async function tagFamilies(next: Ledger): Promise<void> {
    lastTagTry = now();
    tagUnchecked = false;
    const need = next.releases.filter((r) => r.family == null);
    if (need.length === 0) {
      tagPending = false;
      return;
    }
    try {
      const rows = await deps.familiesOf(
        need.map((r) => ({ name: r.artist, artistId: r.artistId })),
        { maxLookups: FAMILY_LOOKUPS_PER_RUN },
      );
      for (const r of need) {
        const family = rows.get(artistKey(r.artist))?.family ?? null;
        if (family) r.family = family;
      }
      // An artist with no row at all was not looked up (a fault or the cap);
      // one the sources do not know has a "none" row and is done.
      tagPending = need.some((r) => !rows.has(artistKey(r.artist)));
    } catch (e) {
      tagPending = true;
      warn('new releases: could not tag the new releases, trying again next run', { reason: reason(e) });
    }
  }

  /** Looks up the genres of the members' top liked artists (a few a run), so
   *  the route, which only reads rows, can tell a member's genres. A tagger
   *  that is down costs nothing. */
  async function tagMembers(members: readonly { id: string; artists: LikedArtist[] }[], order: readonly string[]): Promise<void> {
    const names = new Map(members.flatMap((m) => m.artists).map((a) => [a.artistId, a.name]));
    const refs = order.filter((id) => names.has(id)).map((id) => ({ name: names.get(id)!, artistId: id }));
    if (refs.length === 0) return;
    try {
      await deps.familiesOf(refs, { maxLookups: MEMBER_LOOKUPS_PER_RUN });
    } catch (e) {
      warn('new releases: could not tag the members artists, trying again next run', { reason: reason(e) });
    }
  }

  async function run(): Promise<Ledger | null> {
    const members = (await deps.loadMemberLikes()).map((m) => ({ id: m.id, artists: likedArtists(m.likes) }));
    const likedWatch = buildWatchlist(members);
    const families = await wantedFamilies(members);

    // The charts first: reading them starts their own refresh when they are
    // old, and two paced player runs must never overlap.
    const charts = await deps.genreCharts();
    if (deps.chartsBusy()) {
      lastFailure = now();
      warn('new releases: the genre charts are refreshing, trying again later');
      return ledger;
    }
    const genreWatch = families.length > 0 ? genreWatchlist(charts, families, likedWatch) : [];

    const due = pickDue(ledger?.artists ?? {}, likedWatch, genreWatch);
    const got = await deps.fetchReleases(due, { explore: true });
    if (got.artists.length === 0 && got.explore == null) throw new Error('nothing came back');
    if (got.failed.length) warn('new releases: some artists failed, keeping their known lists', { failed: got.failed });

    const next = applyRun(ledger ?? emptyLedger(), toAnswer(got), now(), [...likedWatch, ...genreWatch]);
    await tagFamilies(next);
    await tagMembers(members, likedWatch);
    ledger = next;
    writeMirror(deps.cacheFile, ledger);
    return ledger;
  }

  function refresh(): Promise<Ledger | null> {
    if (inFlight) return inFlight;
    inFlight = run()
      .catch((e: unknown) => {
        lastFailure = now();
        warn(ledger ? 'new releases: the run failed, keeping the ledger' : 'new releases: no ledger yet and the run failed', {
          reason: reason(e),
        });
        return ledger;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  /** Tags the releases that still have no family, without a YouTube run. */
  function retag(): Promise<Ledger | null> {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      if (!ledger) return ledger;
      const next: Ledger = { ...ledger, releases: ledger.releases.map((r) => ({ ...r })) };
      await tagFamilies(next);
      ledger = next;
      writeMirror(deps.cacheFile, ledger);
      return ledger;
    })()
      .catch(() => ledger)
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  /** The shared ledger's live releases. Never waits and never fetches: it
   *  may start the background run and answers from memory at once. */
  async function get(): Promise<NewReleasesState> {
    if (deps.disabled) return { refreshedAt: null, stale: false, releases: [], recent: [] };
    if (!loaded) {
      ledger = readMirror(deps.cacheFile);
      loaded = true;
      // A restart cannot tell "unknown artist" from "never tried": look once.
      tagUnchecked = !!ledger?.releases.some((r) => r.family == null);
    }
    const at = now();
    const fresh = !!ledger?.refreshedAt && at - Date.parse(ledger.refreshedAt) < ttlMs;
    if (!fresh && at - lastFailure >= retryMs) void refresh();
    else if (fresh && (tagPending || tagUnchecked) && !inFlight && at - lastTagTry >= retryMs) void retag();
    if (!ledger) return { refreshedAt: null, stale: false, releases: [], recent: [] };
    return {
      refreshedAt: ledger.refreshedAt,
      stale: ledger.refreshedAt != null && (!fresh || tagPending),
      releases: ledger.releases.filter((r) => isNew(r.firstSeenAt, at)).map((r) => ({ ...r })),
      recent: Object.values(ledger.artists).flatMap((a) => (a.latest ? [{ ...a.latest }] : [])),
    };
  }

  /** True while a run is in flight (one run at a time). */
  const busy = () => inFlight !== null;

  return { get, busy };
}

export type NewReleasesCache = ReturnType<typeof createNewReleasesCache>;
