import { songKey } from '../songKey';
import { artistKey } from '../genres/artistKey';
import type { Track } from '../../types/track';

/** How much a member likes each song and artist (docs/mixes.md): every
 *  play counts exp(-ageDays / 30), so last week's plays outweigh last
 *  season's, and a like adds 2. Pure. */

export const DECAY_DAYS = 30;
export const LIKE_BONUS = 2;
/** Plays older than this do not count at all. */
export const PLAY_WINDOW_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PlayEvent {
  track: Track;
  /** ISO (or PocketBase's "2026-10-16 10:00:00.000Z"). */
  playedAt: string;
}

export interface SongScore {
  /** lib/songKey: one song across its uploads and versions. */
  key: string;
  track: Track;
  artistKey: string;
  score: number;
  plays: number;
  liked: boolean;
}

export interface ArtistScore {
  key: string;
  name: string;
  artistId: string | null;
  score: number;
  /** Their songs, best first. */
  songs: SongScore[];
}

const parseTime = (s: string) => Date.parse(String(s ?? '').replace(' ', 'T'));

/** Songs by score, best first (ties: more plays, then title). */
export function scoreSongs(plays: readonly PlayEvent[], likes: readonly Track[], now: number): SongScore[] {
  const byKey = new Map<string, SongScore & { lastAt: number }>();
  const entry = (t: Track) => {
    const key = songKey(t);
    let e = byKey.get(key);
    if (!e) {
      e = { key, track: t, artistKey: artistKey(t.artist), score: 0, plays: 0, liked: false, lastAt: -Infinity };
      byKey.set(key, e);
    }
    return e;
  };
  for (const p of plays) {
    if (!p?.track) continue;
    const at = parseTime(p.playedAt);
    if (Number.isNaN(at)) continue;
    const ageDays = Math.max(0, (now - at) / DAY_MS);
    if (ageDays > PLAY_WINDOW_DAYS) continue;
    const e = entry(p.track);
    e.score += Math.exp(-ageDays / DECAY_DAYS);
    e.plays += 1;
    // The version played last stands for the song.
    if (at > e.lastAt) {
      e.lastAt = at;
      e.track = p.track;
    }
  }
  for (const t of likes) {
    if (!t) continue;
    const e = entry(t);
    if (e.liked) continue;
    e.liked = true;
    e.score += LIKE_BONUS;
  }
  return [...byKey.values()]
    .filter((e) => e.artistKey)
    .map(({ lastAt: _lastAt, ...s }) => s)
    .sort((a, b) => b.score - a.score || b.plays - a.plays || a.track.title.localeCompare(b.track.title));
}

/** Artists by the sum of their songs' scores, best first. */
export function scoreArtists(songs: readonly SongScore[]): ArtistScore[] {
  const by = new Map<string, ArtistScore>();
  for (const s of songs) {
    let a = by.get(s.artistKey);
    if (!a) {
      a = { key: s.artistKey, name: s.track.artist, artistId: s.track.artistId ?? null, score: 0, songs: [] };
      by.set(s.artistKey, a);
    }
    a.score += s.score;
    a.songs.push(s);
    if (!a.artistId && s.track.artistId) a.artistId = s.track.artistId;
  }
  return [...by.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
