import { songKey } from '../songKey';
import { artistKey } from '../genres/artistKey';
import type { Track } from '../../types/track';
import type { PlayEvent } from './score';

/** The mixes made only of the member's own history (docs/mixes.md): On
 *  repeat (most played this month) and Throwback (played a lot before, not
 *  in the last two months). No radio, no tags. Pure. */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back the build reads plays: Throwback's "before", and Discover's
 *  "never played". */
export const HISTORY_DAYS = 365;
export const ON_REPEAT_DAYS = 30;
export const ON_REPEAT_MIN_PLAYS = 2;
export const THROWBACK_GAP_DAYS = 60;
/** Plays before the gap a song needs for Throwback (a liked song needs one). */
export const THROWBACK_MIN_PLAYS = 3;
export const HISTORY_MIX_SIZE = 30;
/** History mixes hold only the member's own songs, so they need fewer than
 *  a radio mix's MIN_MIX_SIZE to be worth a tile. */
export const HISTORY_MIN_SIZE = 10;
export const HISTORY_PER_ARTIST_MAX = 5;

export interface SongHistory {
  key: string;
  /** The version played last. */
  track: Track;
  artistKey: string;
  /** Plays in the last ON_REPEAT_DAYS. */
  recent: number;
  /** Plays in the last THROWBACK_GAP_DAYS. */
  sinceGap: number;
  /** Plays before THROWBACK_GAP_DAYS (within HISTORY_DAYS). */
  before: number;
  total: number;
  lastAt: number;
  liked: boolean;
}

const parseTime = (s: string) => Date.parse(String(s ?? '').replace(' ', 'T'));

/** Per song: how often it was played in each window, and whether it is
 *  liked. */
export function songHistory(plays: readonly PlayEvent[], likes: readonly Track[], now: number): Map<string, SongHistory> {
  const out = new Map<string, SongHistory>();
  const entry = (t: Track) => {
    const key = songKey(t);
    let e = out.get(key);
    if (!e) {
      e = { key, track: t, artistKey: artistKey(t.artist), recent: 0, sinceGap: 0, before: 0, total: 0, lastAt: -Infinity, liked: false };
      out.set(key, e);
    }
    return e;
  };
  for (const p of plays) {
    if (!p?.track) continue;
    const at = parseTime(p.playedAt);
    if (Number.isNaN(at)) continue;
    const ageDays = Math.max(0, (now - at) / DAY_MS);
    if (ageDays > HISTORY_DAYS) continue;
    const e = entry(p.track);
    e.total += 1;
    if (ageDays <= ON_REPEAT_DAYS) e.recent += 1;
    if (ageDays <= THROWBACK_GAP_DAYS) e.sinceGap += 1;
    else e.before += 1;
    if (at > e.lastAt) {
      e.lastAt = at;
      e.track = p.track;
    }
  }
  for (const t of likes) if (t) entry(t).liked = true;
  return out;
}

export interface HistoryMix {
  tracks: Track[];
  /** The songs it was built from, best first (the card's faces, the
   *  subtitle's names). */
  songs: SongHistory[];
}

function pick(ranked: readonly SongHistory[], unavailable: ReadonlySet<string>, skip: (t: Track) => boolean): HistoryMix | null {
  const perArtist = new Map<string, number>();
  const songs: SongHistory[] = [];
  for (const s of ranked) {
    if (songs.length >= HISTORY_MIX_SIZE) break;
    if (!s.artistKey || unavailable.has(s.track.id) || skip(s.track)) continue;
    const n = perArtist.get(s.artistKey) ?? 0;
    if (n >= HISTORY_PER_ARTIST_MAX) continue;
    perArtist.set(s.artistKey, n + 1);
    songs.push(s);
  }
  return songs.length >= HISTORY_MIN_SIZE ? { tracks: songs.map((s) => s.track), songs } : null;
}

/** On repeat: the songs played ON_REPEAT_MIN_PLAYS times or more in the
 *  last ON_REPEAT_DAYS, most played first (ties: played last first). */
export function onRepeatMix(history: ReadonlyMap<string, SongHistory>, unavailable: ReadonlySet<string> = new Set(), skip: (t: Track) => boolean = () => false): HistoryMix | null {
  const ranked = [...history.values()]
    .filter((s) => s.recent >= ON_REPEAT_MIN_PLAYS)
    .sort((a, b) => b.recent - a.recent || b.lastAt - a.lastAt || a.track.title.localeCompare(b.track.title));
  return pick(ranked, unavailable, skip);
}

/** Throwback: songs not played in the last THROWBACK_GAP_DAYS that were
 *  played THROWBACK_MIN_PLAYS times or more before (or liked and played at
 *  least once before), the most played first, a like counting two. */
export function throwbackMix(history: ReadonlyMap<string, SongHistory>, unavailable: ReadonlySet<string> = new Set(), skip: (t: Track) => boolean = () => false): HistoryMix | null {
  const score = (s: SongHistory) => s.before + (s.liked ? 2 : 0);
  const ranked = [...history.values()]
    .filter((s) => s.sinceGap === 0 && (s.before >= THROWBACK_MIN_PLAYS || (s.liked && s.before >= 1)))
    .sort((a, b) => score(b) - score(a) || b.lastAt - a.lastAt || a.track.title.localeCompare(b.track.title));
  return pick(ranked, unavailable, skip);
}
