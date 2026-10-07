/** Which songs of a transfer the person has already liked, by name, before
 *  anything is matched: the preview's "already liked" chip, and what "Skip
 *  already liked" leaves out of the job.
 *
 *  A song is already liked when its title and one of its artists make the
 *  same songKey (lib/songKey.ts, the identity the heart uses) as a liked
 *  track and one of its artists, or when it names the exact YouTube video of
 *  a like. Artists are compared one at a time, because a source writes
 *  "June Harbor, Mira Vale" where YouTube Music has only "June Harbor".
 *  Pure. */

import { songKey } from '@/lib/songKey';

export interface LikedIndex {
  keys: Set<string>;
  videos: Set<string>;
}

/** A song as a source or a like has it. */
export interface NamedSong {
  title: string;
  artist: string;
  artists?: readonly string[];
  /** The YouTube video, when the source names one. */
  videoId?: string | null;
}

/** "June Harbor, Mira Vale & Coastline feat. Nora Quill" to its names. */
export function artistParts(artist: string): string[] {
  return artist
    .split(/\s*[,;& ]\s*|\s+(?:feat\.?|ft\.?|featuring|with|x)\s+/i)
    .map((a) => a.trim())
    .filter(Boolean);
}

function keysOf(song: NamedSong): string[] {
  const names = new Set([...(song.artists ?? []), ...artistParts(song.artist), song.artist].map((a) => a.trim()).filter(Boolean));
  return [...names].map((artist) => songKey({ title: song.title, artist }));
}

/** The person's likes, ready to look songs up in. */
export function likedIndex(liked: readonly (NamedSong & { sourceId?: string | null })[]): LikedIndex {
  const keys = new Set<string>();
  const videos = new Set<string>();
  for (const t of liked) {
    for (const k of keysOf(t)) keys.add(k);
    const video = t.videoId ?? t.sourceId;
    if (video) videos.add(video);
  }
  return { keys, videos };
}

export function isAlreadyLiked(song: NamedSong, index: LikedIndex): boolean {
  if (song.videoId && index.videos.has(song.videoId)) return true;
  return keysOf(song).some((k) => index.keys.has(k));
}

/** The songs still to bring over, renumbered from 0 in source order, and
 *  the ones already liked. */
export function splitAlreadyLiked<T extends NamedSong & { position: number }>(
  items: readonly T[],
  index: LikedIndex,
): { fresh: T[]; liked: T[] } {
  const fresh: T[] = [];
  const liked: T[] = [];
  for (const item of items) {
    if (isAlreadyLiked(item, index)) liked.push(item);
    else fresh.push({ ...item, position: fresh.length });
  }
  return { fresh, liked };
}
