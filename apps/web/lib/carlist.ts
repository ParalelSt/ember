/** Carlists (live group sessions): the pure parts, shared by the routes, the
 *  pages and the tests. No React, no PocketBase, no server-only imports. */

import type { PlaylistPerson } from '@/types/track';

/** Join codes are 6 characters today (lib/sessions.ts newSessionCode); the
 *  schema allows 4 to 12. Letters and digits only, upper case. */
const CODE = /^[A-Z0-9]{4,12}$/;

/** A typed or pasted code, cleaned up: upper case, spaces and dashes gone.
 *  null when what is left cannot be a code. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  return CODE.test(code) ? code : null;
}

/** The page that joins whoever opens it (signed in) to the carlist. */
export function carlistJoinPath(code: string): string {
  return `/session/join/${encodeURIComponent(code)}`;
}

export function carlistJoinUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}${carlistJoinPath(code)}`;
}

/** What someone typed or pasted into the Join box: a code, or a whole join
 *  link (any host: the link may come from another device's address). */
export function parseJoinInput(input: string): string | null {
  const text = input.trim();
  const link = text.match(/\/session\/join\/([^/?#\s]+)/i);
  if (link) {
    let code = link[1];
    try {
      code = decodeURIComponent(code);
    } catch {
      return null;
    }
    return normalizeCode(code);
  }
  return normalizeCode(text);
}

// ---------- Adding songs: Play next or Add to end ----------

export type AddPosition = 'next' | 'end';

/** The `position` of an add request: 'next' or 'end', and left out means
 *  'end' (older clients). Anything else is null, a bad request. */
export function parseAddPosition(value: unknown): AddPosition | null {
  if (value === undefined || value === null) return 'end';
  return value === 'next' || value === 'end' ? value : null;
}

/** Where in a queue of `length` songs a new one goes, `nowIndex` playing. */
export function insertIndex(length: number, nowIndex: number, where: AddPosition): number {
  const now = Math.max(0, Math.floor(nowIndex));
  return where === 'next' ? Math.min(now + 1, length) : length;
}

/** Songs that play before one placed at `at` (-1: it is the first song, the
 *  queue was empty). */
export function songsAhead(at: number, nowIndex: number): number {
  return Math.max(-1, at - Math.max(0, nowIndex) - 1);
}

/** "plays next", "3rd in line", "up first". */
export function placeWords(ahead: number): string {
  if (ahead < 0) return 'up first';
  if (ahead === 0) return 'plays next';
  const n = ahead + 1;
  const tens = n % 100;
  const suffix =
    tens >= 11 && tens <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${suffix} in line`;
}

/** The toast after adding a song: where it landed. */
export function addedMessage(title: string, ahead: number): string {
  return `Added "${title}", ${placeWords(ahead)}`;
}

export interface InsertPlan {
  /** Index in the queue the new row takes. */
  at: number;
  /** The new row's `position` value. */
  position: number;
  /** Rows after it that must move down to keep positions strictly
   *  increasing: index in the sorted queue, and its new position. */
  shifts: Array<{ index: number; position: number }>;
  ahead: number;
}

/** Server side of an add: the queue's `position` values in order (sorted
 *  ascending, as stored), what is playing, and where the song should go.
 *  Positions are whole numbers, so playing next renumbers what follows. */
export function planInsert(positions: readonly number[], nowIndex: number, where: AddPosition): InsertPlan {
  const at = insertIndex(positions.length, nowIndex, where);
  const prev = at > 0 ? Number(positions[at - 1]) || 0 : 0;
  const position = prev + 1;
  const shifts: InsertPlan['shifts'] = [];
  let floor = position;
  for (let i = at; i < positions.length; i++) {
    const current = Number(positions[i]) || 0;
    const wanted = Math.max(current, floor + 1);
    if (wanted !== current) shifts.push({ index: i, position: wanted });
    floor = wanted;
  }
  return { at, position, shifts, ahead: songsAhead(at, nowIndex) };
}

// ---------- The host's player mirrors the carlist ----------

interface HasId {
  id: string;
}

/** Puts every carlist song the host's player queue lacks into it, each one
 *  right after the song it follows in the carlist (so Play next lands after
 *  the current song, not at the end), or at the end when nothing before it
 *  is in the player. The playing song stays the playing song. null when
 *  nothing is missing. */
export function mergeIntoPlayerQueue<T extends HasId>(
  playerQueue: readonly T[],
  playerIndex: number,
  sessionTracks: readonly T[],
): { queue: T[]; index: number } | null {
  const queue = [...playerQueue];
  const have = new Set(queue.map((t) => t.id));
  let index = playerQueue.length === 0 ? 0 : playerIndex;
  let changed = false;
  sessionTracks.forEach((track, i) => {
    if (have.has(track.id)) return;
    let at = queue.length;
    for (let j = i - 1; j >= 0; j--) {
      const pos = queue.findIndex((t) => t.id === sessionTracks[j].id);
      if (pos >= 0) {
        at = pos + 1;
        break;
      }
    }
    queue.splice(at, 0, track);
    have.add(track.id);
    if (playerQueue.length > 0 && at <= index) index++;
    changed = true;
  });
  return changed ? { queue, index } : null;
}

/** Which carlist row the host is playing: the row holding the player's
 *  current song, the first at or after the last known one when a song is in
 *  the carlist twice. -1 when the player is on something else. */
export function sessionIndexFor(sessionIds: readonly string[], currentId: string | null | undefined, lastIndex: number): number {
  if (!currentId) return -1;
  let before = -1;
  for (let i = 0; i < sessionIds.length; i++) {
    if (sessionIds[i] !== currentId) continue;
    if (i >= lastIndex) return i;
    before = i;
  }
  return before;
}

// ---------- People ----------

export type CarlistPerson = PlaylistPerson;

/** How a person shows on the carlist screen: "You" for the viewer. */
export function personLabel(person: Pick<CarlistPerson, 'id' | 'name'> | null | undefined, viewerId: string): string {
  if (!person) return 'Unnamed member';
  return person.id === viewerId ? 'You' : person.name;
}

/** "Hana's phone plays" / "your phone plays". */
export function whosePhone(hostName: string, isHost: boolean): string {
  return isHost ? 'your phone plays' : `${hostName}'s phone plays`;
}

// ---------- Progress ----------

/** How far through the current song a guest's bar shows, 0 to 1: the
 *  server's elapsed time when the poll answered plus the time since. null
 *  when it cannot be known (no duration, no time). It does not see the host
 *  pause, so it is an estimate; the host's own bar uses the player. */
export function estimateProgress(opts: {
  elapsedMs: number | null | undefined;
  fetchedAt: number;
  now: number;
  durationSec: number | null | undefined;
}): number | null {
  const { elapsedMs, fetchedAt, now, durationSec } = opts;
  if (elapsedMs == null || !durationSec || durationSec <= 0 || !fetchedAt) return null;
  const ms = elapsedMs + Math.max(0, now - fetchedAt);
  return Math.min(1, Math.max(0, ms / (durationSec * 1000)));
}
