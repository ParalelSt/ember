import { findLikedVariant } from '@/lib/songKey';
import type { Track } from '@/types/track';

/** The pure rules behind the Playlist copy candidates: how a list sorts and
 *  which picked songs a destination already has. The candidates draw from
 *  these so the mock result ("Added 12, skipped 3 already there") is what
 *  the real rule gives, not a number typed in. The build stage moves this
 *  file to lib/playlistCopy.ts (docs/superpowers/plans/2026-09-24-playlist-copy.md). */

/** A song in a collection, with when it was added there (a playlist row's
 *  `created`, a like's `liked_at`). */
export interface CopyTrack extends Track {
  addedAt: string;
}

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

/** Playlist order: a playlist appends, so its own order is date added,
 *  oldest first. */
export const DEFAULT_SORT: SortState = { key: 'added', dir: 'asc' };

export function sortLabel(sort: SortState): string {
  const k = SORT_KEYS.find((s) => s.key === sort.key)!;
  return `${k.label}, ${sort.dir === 'asc' ? k.asc : k.desc}`;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** A sorted copy (never the input). Ties keep the list's own order, in both
 *  directions, so flipping the direction never shuffles equal songs. */
export function sortTracks<T extends CopyTrack>(tracks: T[], sort: SortState): T[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const compare = (a: T, b: T): number => {
    switch (sort.key) {
      case 'title':
        return collator.compare(a.title, b.title);
      case 'artist':
        return collator.compare(a.artist, b.artist) || collator.compare(a.title, b.title);
      case 'duration':
        return a.durationSec - b.durationSec;
      case 'added':
        return a.addedAt < b.addedAt ? -1 : a.addedAt > b.addedAt ? 1 : 0;
    }
  };
  return tracks
    .map((t, i) => [t, i] as const)
    .sort(([a, ai], [b, bi]) => sign * compare(a, b) || ai - bi)
    .map(([t]) => t);
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
 *  there has the same id, or the same `songKey`. After the same-title fix
 *  (4fbdb92) a songKey needs the same title AND the same artist AND the
 *  same version markers (live, remix, instrumental...), with a non-Latin
 *  title or artist kept as written, and a song with no artist keys on its
 *  own id. So two different songs called "Home" are never duplicates, and
 *  "Blinding Lights (Official Video)" is the same song as "Blinding
 *  Lights". */
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

/** "Added 12, skipped 3 already there", the line the owner asked for. */
export function resultLine(plan: CopyPlan): string {
  const added = `Added ${plan.add.length}`;
  if (plan.skipped.length === 0) return added;
  return `${added}, skipped ${plan.skipped.length} already there`;
}

/** Why one song was skipped, in plain words. */
export function skipLine(s: Skipped): string {
  switch (s.reason) {
    case 'same-track':
      return 'already there';
    case 'other-version':
      return `already there as "${s.existing.title}"`;
    case 'picked-twice':
      return 'picked twice, added once';
  }
}
