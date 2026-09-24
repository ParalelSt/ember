import { findLikedVariant } from '@/lib/songKey';
import type { Track } from '@/types/track';

/** Copying songs between playlists: how a collection sorts, and which picked
 *  songs a destination already has. Shared by the page (the "N already
 *  there" counts, the Liked songs warning) and the two bulk routes, which
 *  re-run `planCopy` against the database, so the client and the server can
 *  never disagree about what a duplicate is. Pure: no React, no PocketBase. */

/** A song in a collection, with when it was added there (a playlist row's
 *  `created`, a like's `liked_at`). Optional because a song the page adds
 *  optimistically (a heart tapped a moment ago) has no server time yet. */
export type SortableTrack = Track & { addedAt?: string };

export type SortKey = 'added' | 'title' | 'artist' | 'duration';
export type SortDir = 'asc' | 'desc';

export interface SortState {
  key: SortKey;
  dir: SortDir;
}

export const SORT_KEYS: { key: SortKey; label: string; asc: string; desc: string }[] = [
  { key: 'title', label: 'Title', asc: 'A to Z', desc: 'Z to A' },
  { key: 'artist', label: 'Artist', asc: 'A to Z', desc: 'Z to A' },
  { key: 'added', label: 'Date added', asc: 'Oldest first', desc: 'Newest first' },
  { key: 'duration', label: 'Duration', asc: 'Shortest first', desc: 'Longest first' },
];

/** A playlist appends, so its own order is date added, oldest first. */
export const DEFAULT_PLAYLIST_SORT: SortState = { key: 'added', dir: 'asc' };
/** Liked songs has always shown the newest like on top. */
export const DEFAULT_LIKED_SORT: SortState = { key: 'added', dir: 'desc' };

export function sortLabel(sort: SortState): string {
  const k = SORT_KEYS.find((s) => s.key === sort.key) ?? SORT_KEYS[2];
  return `${k.label}, ${sort.dir === 'asc' ? k.asc : k.desc}`;
}

export function isSortState(v: unknown): v is SortState {
  const s = v as SortState | null;
  return !!s && SORT_KEYS.some((k) => k.key === s.key) && (s.dir === 'asc' || s.dir === 'desc');
}

export function sameSort(a: SortState, b: SortState): boolean {
  return a.key === b.key && a.dir === b.dir;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** No time yet means "just now": it sorts after every dated song. */
const NOW = '￿';

/** A sorted copy (never the input). Ties keep the list's own order, in both
 *  directions, so flipping the direction never shuffles equal songs. */
export function sortTracks<T extends SortableTrack>(tracks: T[], sort: SortState): T[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const compare = (a: T, b: T): number => {
    switch (sort.key) {
      case 'title':
        return collator.compare(a.title, b.title);
      case 'artist':
        return collator.compare(a.artist, b.artist) || collator.compare(a.title, b.title);
      case 'duration':
        return (a.durationSec || 0) - (b.durationSec || 0);
      case 'added': {
        const x = a.addedAt || NOW;
        const y = b.addedAt || NOW;
        return x < y ? -1 : x > y ? 1 : 0;
      }
    }
  };
  return tracks
    .map((t, i) => [t, i] as const)
    .sort(([a, ai], [b, bi]) => sign * compare(a, b) || ai - bi)
    .map(([t]) => t);
}

/** The collection as the page shows it. The collection's default order is
 *  the server's own (a playlist's positions, Liked songs' newest like
 *  first), which is what "Date added" means there, so the default returns
 *  the list untouched rather than re-deriving it from timestamps (an
 *  imported playlist's rows are not created in position order). */
export function sortCollection<T extends SortableTrack>(tracks: T[], sort: SortState, byDefault: SortState): T[] {
  return sameSort(sort, byDefault) ? tracks : sortTracks(tracks, sort);
}

/** Why a picked song was not added. */
export type SkipReason =
  /** The destination has this exact track. */
  | 'same-track'
  /** The destination has another upload of the same recording ("Harbor
   *  Lights (Official Video)" by "Coastline - Topic"). */
  | 'other-version'
  /** Two picked songs are the same song: the first one goes in. */
  | 'picked-twice';

export interface Skipped {
  track: Track;
  reason: SkipReason;
  /** What is already there (or the picked song it repeats). */
  existing: Track;
}

export interface CopyPlan {
  add: Track[];
  skipped: Skipped[];
}

/** The duplicate rule, the same one the Liked hearts use
 *  (`findLikedVariant`): a song is already in `destination` when a track
 *  there has the same id, or the same `songKey`. A songKey needs the same
 *  title AND the same artist AND the same version markers (live, remix,
 *  instrumental...), with a non-Latin title or artist kept as written, and
 *  a song with no artist keys on its own id. So two different songs called
 *  "Home" are never duplicates, and "Blinding Lights (Official Video)" is
 *  the same song as "Blinding Lights". */
export function alreadyThere(track: Track, destination: Track[]): Track | null {
  return findLikedVariant(track, destination);
}

/** What copying `picked` into `destination` does: every song not already
 *  there goes in once, in the picked order. */
export function planCopy(picked: Track[], destination: Track[]): CopyPlan {
  const add: Track[] = [];
  const skipped: Skipped[] = [];
  for (const track of picked) {
    const existing = alreadyThere(track, destination);
    if (existing) {
      skipped.push({ track, existing, reason: existing.id === track.id ? 'same-track' : 'other-version' });
      continue;
    }
    const twin = alreadyThere(track, add);
    if (twin) {
      skipped.push({ track, existing: twin, reason: 'picked-twice' });
      continue;
    }
    add.push(track);
  }
  return { add, skipped };
}

/** How many of the picked songs a destination already has (a song picked
 *  twice is not "there"). */
export function alreadyCount(picked: Track[], destination: Track[]): number {
  return planCopy(picked, destination).skipped.filter((s) => s.reason !== 'picked-twice').length;
}

/** One skipped song as the bulk routes answer it. */
export interface CopySkip {
  id: string;
  title: string;
  artist: string;
  reason: SkipReason;
  /** The title of what is already there (or of the picked song it repeats). */
  existingTitle: string;
}

/** What a bulk route answers: how many went in, and which were skipped. */
export interface CopyOutcome {
  added: number;
  skipped: CopySkip[];
}

export function toSkip(s: Skipped): CopySkip {
  return {
    id: s.track.id,
    title: s.track.title,
    artist: s.track.artist,
    reason: s.reason,
    existingTitle: s.existing.title,
  };
}

/** The most songs one bulk request may carry. */
export const MAX_BULK = 500;

/** "Added 12, skipped 3 already there", the line the owner asked for. */
export function resultLine(outcome: { added: number; skipped: unknown[] }): string {
  const added = `Added ${outcome.added}`;
  if (outcome.skipped.length === 0) return added;
  return `${added}, skipped ${outcome.skipped.length} already there`;
}

/** Why one song was skipped, in plain words. */
export function skipLine(s: Pick<CopySkip, 'reason' | 'existingTitle'>): string {
  switch (s.reason) {
    case 'same-track':
      return 'already there';
    case 'other-version':
      return `already there as "${s.existingTitle}"`;
    case 'picked-twice':
      return 'picked twice, added once';
  }
}
