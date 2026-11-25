import { firstArtist } from '../genres/artistKey';
import { chartsOfFamily, type FamilySlug } from '../genres/taxonomy';
import {
  MINE_MAX,
  MINE_PER_ARTIST,
  SIMILAR_MAX,
  SIMILAR_PER_ARTIST,
  type NewReleaseItem,
  type NewReleaseKind,
} from '../newReleasesView';

/** The rules behind the "New releases" row (docs/new-releases-plan.md).
 *  Constants and pure functions only: no I/O, and nothing reads the clock,
 *  every function that needs a time takes it as an argument. The cache runs
 *  the player and the files; this file decides what is new, what to scan
 *  and what a member sees. */

const DAY_MS = 24 * 60 * 60 * 1000;

export const NEW_WINDOW_DAYS = 42;
export const NEW_WINDOW_MS = NEW_WINDOW_DAYS * DAY_MS;
export const LIKED_WATCH_MAX = 60;
export const GENRE_WATCH_MAX = 30;
export const GENRE_PER_CHART = 8;
export const SCANS_PER_RUN = 18;
export const LIKED_SCANS = 12;
export const GENRE_SCANS = 6;
export const KNOWN_MAX = 60;
/** A release this recent may fill a member's row at once, even on the first
 *  scan of its artist (the year is all YouTube gives, so the gate is by year). */
export const RECENT_WINDOW_DAYS = 90;
export const PERSONAL_MAX = 12;
/** Fewer personal picks than this and the shelf fills the row. */
export const ROW_MIN = 6;
export const ROW_FILL_TO = 8;
export const RETIRED_MAX = 500;
/** An artist that left every watchlist keeps its entry this long, so
 *  coming back is not a second baseline. */
export const IDLE_KEEP_MS = 30 * DAY_MS;
export const GENRE_TOP_ARTISTS = 60;
export const MEMBER_FAMILIES_MAX = 3;
export const FAMILY_MIN_SHARE = 0.1;

/** Same shape the Track carries for a YouTube artist id. */
const ARTIST_ID = /^[A-Za-z0-9_-]{8,40}$/;

export interface LikeRow {
  source: string;
  artistId: string | null;
  /** The track's artist credit. */
  artist: string;
  likedAt: string | null;
  created: string;
}

export interface LikedArtist {
  artistId: string;
  name: string;
  /** Liked songs. */
  count: number;
  lastLikedAt: string;
}

export interface LedgerArtist {
  /** The artist's newest release on the last scan, when it is recent enough
   *  (year inside the RECENT_WINDOW_DAYS window) to show on a first look. */
  latest?: Release | null;
  name: string;
  checkedAt: string;
  /** null until one scan succeeded: that scan is the baseline. */
  scannedAt: string | null;
  /** Newest first, last KNOWN_MAX. */
  known: string[];
}

export interface Release {
  browseId: string;
  title: string;
  kind: NewReleaseKind;
  year: number | null;
  artworkUrl: string | null;
  artist: string;
  artistId: string | null;
  family: FamilySlug | null;
  firstSeenAt: string;
  via: 'artist' | 'explore';
}

export interface Ledger {
  version: 1;
  refreshedAt: string | null;
  artists: Record<string, LedgerArtist>;
  /** New ones only. */
  releases: Release[];
  /** The last RETIRED_MAX browseIds that aged out. */
  retired: string[];
}

export interface PlayerArtistRelease {
  browseId: string;
  title: string;
  year: number | null;
  type: string;
  artworkUrl: string | null;
}

export interface PlayerExploreItem {
  browseId: string;
  title: string;
  type: string;
  artist: string;
  artistId: string | null;
  artworkUrl: string | null;
}

/** What `player.py new-releases` answers, as parsed by parseNewReleases. */
export interface NewReleasesAnswer {
  artists: { id: string; name: string; releases: PlayerArtistRelease[] }[];
  explore: PlayerExploreItem[] | null;
  failed: string[];
}

export const emptyLedger = (): Ledger => ({ version: 1, refreshedAt: null, artists: {}, releases: [], retired: [] });

const byCountThenRecent = (a: LikedArtist, b: LikedArtist) =>
  b.count - a.count || (a.lastLikedAt < b.lastLikedAt ? 1 : a.lastLikedAt > b.lastLikedAt ? -1 : 0) || a.artistId.localeCompare(b.artistId);

/** A member's liked artists: YouTube likes with a well formed artist id,
 *  grouped by that id. Uploads and Jamendo have no YouTube artist page, and
 *  a like without an id is skipped rather than looked up (a lookup is a
 *  YouTube search). Ranked by count, then latest like. */
export function likedArtists(rows: readonly LikeRow[]): LikedArtist[] {
  const byId = new Map<string, LikedArtist & { nameAt: string }>();
  for (const r of rows) {
    if (r.source !== 'youtube' || !r.artistId || !ARTIST_ID.test(r.artistId)) continue;
    const at = r.likedAt || r.created;
    const cur = byId.get(r.artistId);
    if (!cur) {
      byId.set(r.artistId, { artistId: r.artistId, name: firstArtist(r.artist), count: 1, lastLikedAt: at, nameAt: at });
      continue;
    }
    cur.count += 1;
    if (at > cur.lastLikedAt) cur.lastLikedAt = at;
    // The name comes from the most recent like, so a renamed artist updates.
    if (at >= cur.nameAt) {
      cur.nameAt = at;
      cur.name = firstArtist(r.artist);
    }
  }
  return [...byId.values()]
    .map(({ nameAt: _nameAt, ...a }) => a)
    .sort(byCountThenRecent);
}

/** What gets scanned for liked artists, server-wide: members in id order,
 *  one artist each in turn, skipping artists already taken. The fixed order
 *  keeps the list stable between runs. */
export function buildWatchlist(
  members: readonly { id: string; artists: readonly LikedArtist[] }[],
  max = LIKED_WATCH_MAX,
): string[] {
  const queues = [...members]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((m) => [...m.artists].sort(byCountThenRecent).map((a) => a.artistId));
  const taken = new Set<string>();
  const out: string[] = [];
  const pos = queues.map(() => 0);
  let progressed = true;
  while (out.length < max && progressed) {
    progressed = false;
    for (let m = 0; m < queues.length && out.length < max; m++) {
      const q = queues[m];
      while (pos[m] < q.length && taken.has(q[pos[m]])) pos[m]++;
      if (pos[m] >= q.length) continue;
      const id = q[pos[m]++];
      taken.add(id);
      out.push(id);
      progressed = true;
    }
  }
  return out;
}

/** Artists to scan for "similar" suggestions: the charts of the wanted
 *  families, the first GENRE_PER_CHART distinct artists of each by rank,
 *  charts taken in turn. Artists without an id and ones already on the
 *  liked watchlist are skipped, so a chart's slot goes to the next artist. */
export function genreWatchlist(
  charts: readonly { slug: string; tracks: readonly { artistId: string | null }[] }[],
  families: readonly FamilySlug[],
  liked: ReadonlySet<string> | readonly string[],
  max = GENRE_WATCH_MAX,
): string[] {
  const skip = liked instanceof Set ? liked : new Set(liked);
  const wanted = new Set(families.flatMap((f) => chartsOfFamily(f).map((c) => c.slug)));
  const lists = charts
    .filter((c) => wanted.has(c.slug))
    .map((c) => {
      const seen = new Set<string>();
      const ids: string[] = [];
      for (const t of c.tracks) {
        if (ids.length >= GENRE_PER_CHART) break;
        const id = t.artistId;
        if (!id || !ARTIST_ID.test(id) || skip.has(id) || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
      return ids;
    });
  const taken = new Set<string>();
  const out: string[] = [];
  const pos = lists.map(() => 0);
  let progressed = true;
  while (out.length < max && progressed) {
    progressed = false;
    for (let i = 0; i < lists.length && out.length < max; i++) {
      while (pos[i] < lists[i].length && taken.has(lists[i][pos[i]])) pos[i]++;
      if (pos[i] >= lists[i].length) continue;
      const id = lists[i][pos[i]++];
      taken.add(id);
      out.push(id);
      progressed = true;
    }
  }
  return out;
}

/** Never-checked artists first, in rank order, then the oldest checkedAt
 *  (ties keep rank order). */
function dueOf(ids: readonly string[], artists: Ledger['artists']): string[] {
  const rank = new Map(ids.map((id, i) => [id, i]));
  return [...ids].sort((a, b) => {
    const ea = artists[a];
    const eb = artists[b];
    if (!ea || !eb) return ea ? 1 : eb ? -1 : rank.get(a)! - rank.get(b)!;
    return (ea.checkedAt < eb.checkedAt ? -1 : ea.checkedAt > eb.checkedAt ? 1 : 0) || rank.get(a)! - rank.get(b)!;
  });
}

/** The ids one run scans: 12 liked and 6 genre ones, least recently checked
 *  first. A list with fewer due gives its spare to the other, never more
 *  than SCANS_PER_RUN in all. */
export function pickDue(
  artists: Ledger['artists'],
  likedWatch: readonly string[],
  genreWatch: readonly string[],
  total = SCANS_PER_RUN,
  likedShare = LIKED_SCANS,
): string[] {
  const liked = dueOf(likedWatch, artists);
  const genre = dueOf(genreWatch.filter((id) => !likedWatch.includes(id)), artists);
  const genreShare = total - likedShare;
  const likedTake = Math.min(liked.length, likedShare + Math.max(0, genreShare - genre.length));
  const genreTake = Math.min(genre.length, genreShare + Math.max(0, likedShare - liked.length));
  return [...liked.slice(0, likedTake), ...genre.slice(0, genreTake)].slice(0, total);
}

/** New for NEW_WINDOW_DAYS from first sight. */
export function isNew(firstSeenAt: string, now: number): boolean {
  const t = Date.parse(firstSeenAt);
  return Number.isFinite(t) && now - t < NEW_WINDOW_MS;
}

function kindOf(type: string | null | undefined, fallback: NewReleaseKind): NewReleaseKind {
  const t = String(type ?? '').toLowerCase();
  if (t === 'album') return 'album';
  if (t === 'ep') return 'ep';
  if (t === 'single') return 'single';
  return fallback;
}

const newestFirst = (a: Release, b: Release) => (a.firstSeenAt < b.firstSeenAt ? 1 : a.firstSeenAt > b.firstSeenAt ? -1 : 0);

/** Folds one player answer into the ledger and returns the new ledger (the
 *  input is not touched). `watched` is every id on either watchlist now;
 *  `now` is the run's time in ms.
 *
 *  YouTube gives a year at best, so "new" is first sight, see the plan's
 *  Definitions: the explore shelf, an id missing from an artist's known list
 *  after the first scan (year gated), or, on the baseline scan, only a
 *  release whose year starts inside the window. */
export function applyRun(
  ledger: Ledger,
  answer: NewReleasesAnswer,
  now: number,
  watched: readonly string[] = [],
): Ledger {
  const nowIso = new Date(now).toISOString();
  const windowStartYear = new Date(now - NEW_WINDOW_MS).getUTCFullYear();

  // Age out first, so a retired id blocks both sources in this very run.
  const retired = [...ledger.retired];
  const releases: Release[] = [];
  for (const r of ledger.releases) {
    if (isNew(r.firstSeenAt, now)) releases.push({ ...r });
    else if (!retired.includes(r.browseId)) retired.push(r.browseId);
  }
  const retiredSet = new Set(retired);
  const byId = new Map(releases.map((r) => [r.browseId, r]));

  const upsert = (r: Release) => {
    if (retiredSet.has(r.browseId)) return;
    const have = byId.get(r.browseId);
    if (have) {
      if (r.firstSeenAt < have.firstSeenAt) have.firstSeenAt = r.firstSeenAt;
      if (have.year == null && r.year != null) have.year = r.year;
      if (!have.artworkUrl && r.artworkUrl) have.artworkUrl = r.artworkUrl;
      if (!have.artistId && r.artistId) have.artistId = r.artistId;
      return;
    }
    byId.set(r.browseId, r);
    releases.push(r);
  };

  const artists: Ledger['artists'] = {};
  for (const [id, a] of Object.entries(ledger.artists)) artists[id] = { ...a, known: [...a.known] };

  for (const a of answer.artists) {
    const prev = artists[a.id];
    const baseline = !prev || prev.scannedAt == null;
    const known = new Set(prev?.known ?? []);
    const page: string[] = [];
    for (const rel of a.releases) {
      if (!rel.browseId || page.includes(rel.browseId)) continue;
      page.push(rel.browseId);
      if (known.has(rel.browseId) && !baseline) continue;
      let firstSeenAt: string | null = null;
      if (baseline) {
        // A year cannot tell January from November, except when 1 January
        // itself is still inside the window.
        if (rel.year != null) {
          const jan1 = Date.UTC(rel.year, 0, 1);
          if (jan1 <= now && now - jan1 < NEW_WINDOW_MS) firstSeenAt = new Date(jan1).toISOString();
        }
      } else if (rel.year == null || rel.year >= windowStartYear) {
        firstSeenAt = nowIso;
      }
      if (!firstSeenAt) continue;
      upsert({
        browseId: rel.browseId,
        title: rel.title,
        kind: kindOf(rel.type, 'album'),
        year: rel.year ?? null,
        artworkUrl: rel.artworkUrl ?? null,
        artist: a.name,
        artistId: a.id,
        family: null,
        firstSeenAt,
        via: 'artist',
      });
    }
    const merged = [...page, ...(prev?.known ?? []).filter((k) => !page.includes(k))].slice(0, KNOWN_MAX);
    // The newest release (highest year, page order on a tie), if recent.
    const recentYear = new Date(now - RECENT_WINDOW_DAYS * DAY_MS).getUTCFullYear();
    let top: (typeof a.releases)[number] | null = null;
    for (const rel of a.releases) {
      if (!rel.browseId || (rel.year != null && rel.year < recentYear)) continue;
      if (!top || (rel.year ?? Infinity) > (top.year ?? Infinity)) top = rel;
    }
    const latest: Release | null = top
      ? {
          browseId: top.browseId,
          title: top.title,
          kind: kindOf(top.type, 'album'),
          year: top.year ?? null,
          artworkUrl: top.artworkUrl ?? null,
          artist: a.name,
          artistId: a.id,
          family: null,
          firstSeenAt: nowIso,
          via: 'artist',
        }
      : null;
    artists[a.id] = { name: a.name || prev?.name || '', checkedAt: nowIso, scannedAt: nowIso, known: merged, latest };
  }

  // A dead channel keeps its list and still moves on, so it never blocks the queue.
  for (const id of answer.failed) {
    if (id === 'explore') continue;
    const prev = artists[id];
    artists[id] = { name: prev?.name ?? '', checkedAt: nowIso, scannedAt: prev?.scannedAt ?? null, known: prev?.known ?? [], latest: prev?.latest ?? null };
  }

  for (const item of answer.explore ?? []) {
    if (!item.browseId || !String(item.artist ?? '').trim()) continue;
    upsert({
      browseId: item.browseId,
      title: item.title,
      kind: kindOf(item.type, 'album'),
      year: null,
      artworkUrl: item.artworkUrl ?? null,
      artist: item.artist,
      artistId: item.artistId ?? null,
      family: null,
      firstSeenAt: nowIso,
      via: 'explore',
    });
  }

  const keep = new Set(watched);
  for (const [id, a] of Object.entries(artists)) {
    if (!keep.has(id) && now - Date.parse(a.checkedAt) > IDLE_KEEP_MS) delete artists[id];
  }

  const gotSomething = answer.artists.length > 0 || answer.explore != null;
  return {
    version: 1,
    refreshedAt: gotSomething ? nowIso : ledger.refreshedAt,
    artists,
    releases: releases.sort(newestFirst),
    retired: retired.slice(-RETIRED_MAX),
  };
}

/** A member's genres: the primary families of their top artists, weighted by
 *  liked songs. The top MEMBER_FAMILIES_MAX, leaving out any under 10% of the
 *  tagged total. Untagged artists do not count; no tagged artist, no genres. */
export function memberFamilies(
  liked: readonly LikedArtist[],
  familyOf: (artist: LikedArtist) => FamilySlug | null | undefined,
): FamilySlug[] {
  const totals = new Map<FamilySlug, number>();
  let tagged = 0;
  for (const a of [...liked].sort(byCountThenRecent).slice(0, GENRE_TOP_ARTISTS)) {
    const f = familyOf(a);
    if (!f) continue;
    totals.set(f, (totals.get(f) ?? 0) + a.count);
    tagged += a.count;
  }
  if (tagged === 0) return [];
  return [...totals.entries()]
    .filter(([, n]) => n / tagged >= FAMILY_MIN_SHARE)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MEMBER_FAMILIES_MAX)
    .map(([f]) => f);
}

const toItem = (r: Release, from: NewReleaseItem['from']): NewReleaseItem => ({
  browseId: r.browseId,
  title: r.title,
  kind: r.kind,
  artist: r.artist,
  artistId: r.artistId,
  artworkUrl: r.artworkUrl,
  year: r.year,
  firstSeenAt: r.firstSeenAt,
  from,
});

/** The row for one member: their liked artists' releases first, then
 *  suggestions from their genres, each capped and newest first. */
export function selectForMember(
  releases: readonly Release[],
  liked: readonly LikedArtist[],
  families: readonly FamilySlug[],
  now: number,
): NewReleaseItem[] {
  const likedBy = new Map(liked.map((a) => [a.artistId, a]));
  const fam = new Set(families);
  const fresh = releases.filter((r) => isNew(r.firstSeenAt, now));

  const cap = (list: Release[], perArtist: number, max: number, from: NewReleaseItem['from']) => {
    const per = new Map<string, number>();
    const out: NewReleaseItem[] = [];
    for (const r of list) {
      if (out.length >= max) break;
      const key = r.artistId ?? '';
      const n = per.get(key) ?? 0;
      if (n >= perArtist) continue;
      per.set(key, n + 1);
      out.push(toItem(r, from));
    }
    return out;
  };

  const mine = fresh
    .filter((r) => r.artistId != null && likedBy.has(r.artistId))
    .sort((a, b) => newestFirst(a, b) || (likedBy.get(b.artistId!)!.count - likedBy.get(a.artistId!)!.count) || a.browseId.localeCompare(b.browseId));
  const similar = fresh
    .filter((r) => r.artistId != null && !likedBy.has(r.artistId) && r.family != null && fam.has(r.family))
    .sort((a, b) => newestFirst(a, b) || a.browseId.localeCompare(b.browseId));

  return [...cap(mine, MINE_PER_ARTIST, MINE_MAX, 'liked'), ...cap(similar, SIMILAR_PER_ARTIST, SIMILAR_MAX, 'similar')];
}

/** Plays, as the row needs them: who, and when. */
export interface PlayRow {
  source: string;
  artistId: string | null;
  artist: string;
  playedAt: string;
}

export interface PlayStat {
  /** Plays in the last 7 days. */
  p7: number;
  /** Plays 7 to 30 days ago. */
  p30: number;
}

/** Play counts per YouTube artist id, in the last 7 days and the 23 before. */
export function playStats(rows: readonly PlayRow[], now: number): Map<string, PlayStat> {
  const out = new Map<string, PlayStat>();
  for (const r of rows) {
    if (r.source !== 'youtube' || !r.artistId || !ARTIST_ID.test(r.artistId)) continue;
    const age = now - Date.parse(r.playedAt);
    if (!Number.isFinite(age) || age < 0 || age > 30 * DAY_MS) continue;
    const s = out.get(r.artistId) ?? { p7: 0, p30: 0 };
    if (age <= 7 * DAY_MS) s.p7++;
    else s.p30++;
    out.set(r.artistId, s);
  }
  return out;
}

/** The draw weight of an artist: liked only is 1, a play in the last month
 *  adds 1.5, one in the last week adds 5. */
export const artistWeight = (s: PlayStat | undefined): number => 1 + 5 * (s?.p7 ?? 0) + 1.5 * (s?.p30 ?? 0);

/** Draws up to `k` distinct items, each draw proportional to the weights of
 *  those left. `random` returns [0, 1). */
export function weightedSample<T>(items: readonly T[], weight: (t: T) => number, k: number, random: () => number): T[] {
  const left = [...items];
  const out: T[] = [];
  while (out.length < k && left.length > 0) {
    const total = left.reduce((n, t) => n + weight(t), 0);
    let at = random() * total;
    let i = 0;
    for (; i < left.length - 1; i++) {
      at -= weight(left[i]);
      if (at < 0) break;
    }
    out.push(left.splice(i, 1)[0]);
  }
  return out;
}

const artistSlot = (r: { artistId: string | null; artist: string }) => r.artistId ?? `n:${r.artist.trim().toLowerCase()}`;

/** The row for one member (docs/new-releases.md): each liked or played
 *  artist's newest recent release, a weighted random draw that favours what
 *  they played this week, then this month, then liked only; never one artist
 *  twice. Under ROW_MIN picks, the shelf fills the rest (their genres
 *  first). Empty only when there is truly nothing. */
export function buildRow(input: {
  /** The ledger's live releases (first seen inside the window). */
  releases: readonly Release[];
  /** Each scanned artist's newest recent release. */
  recent: readonly Release[];
  /** Liked and played artists. */
  liked: readonly LikedArtist[];
  plays: ReadonlyMap<string, PlayStat>;
  families: readonly FamilySlug[];
  now: number;
  random?: () => number;
}): NewReleaseItem[] {
  const { releases, recent, liked, plays, families, now } = input;
  const random = input.random ?? Math.random;
  const fresh = releases.filter((r) => isNew(r.firstSeenAt, now));

  const best = new Map<string, Release>();
  for (const r of [...fresh].sort(newestFirst)) if (r.artistId && !best.has(r.artistId)) best.set(r.artistId, r);
  for (const r of recent) if (r.artistId && !best.has(r.artistId)) best.set(r.artistId, r);

  const pool = liked.filter((a) => best.has(a.artistId));
  const picked = weightedSample(pool, (a) => artistWeight(plays.get(a.artistId)), PERSONAL_MAX, random);
  const out = picked.map((a) => toItem(best.get(a.artistId)!, 'liked'));
  const used = new Set(picked.map((a) => a.artistId));
  const usedNames = new Set(picked.map((a) => a.name.trim().toLowerCase()));

  if (out.length < ROW_MIN) {
    const fam = new Set(families);
    const shelf = fresh
      .filter((r) => r.via === 'explore' && !(r.artistId && used.has(r.artistId)) && !usedNames.has(r.artist.trim().toLowerCase()))
      .map((r, i) => ({ r, i, match: r.family != null && fam.has(r.family) ? 0 : 1 }))
      .sort((a, b) => a.match - b.match || a.i - b.i);
    const seen = new Set(out.map((o) => artistSlot(o)));
    for (const { r } of shelf) {
      if (out.length >= ROW_FILL_TO) break;
      const slot = artistSlot(r);
      if (seen.has(slot)) continue;
      seen.add(slot);
      out.push(toItem(r, 'similar'));
    }
  }
  return out;
}
