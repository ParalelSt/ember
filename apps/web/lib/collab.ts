/** Collaborative playlists: the pure parts, shared by the routes, the pages
 *  and the tests. No React, no PocketBase, no server-only imports. The
 *  access check itself is server-side, in lib/playlistAccess.ts. */

import type { PlaylistPerson, PlaylistRole } from '@/types/track';

/** GET /api/playlists/:id/collab: what the Collaborate sheet shows. */
export interface CollabState {
  collaborative: boolean;
  role: PlaylistRole;
  owner: PlaylistPerson;
  members: PlaylistPerson[];
  maxMembers: number;
  /** The owner only: the invite code, or null while the link is off. */
  inviteCode?: string | null;
}

/** POST /api/playlists/join/preview `{ code }`: what the invite card shows before you
 *  join. Names and faces only (never an email or a user id), the first
 *  few songs, and `playlistId` only for someone already on it. */
export interface InvitePreview {
  name: string;
  artworkUrl: string | null;
  owner: Pick<PlaylistPerson, 'name' | 'avatarUrl'>;
  /** The owner first, then the members, at most PREVIEW_PEOPLE of them. */
  people: Pick<PlaylistPerson, 'name' | 'avatarUrl'>[];
  /** Everyone on it, the owner included. */
  peopleCount: number;
  songCount: number;
  /** The first PREVIEW_SONGS songs in the playlist's own order. */
  songs: { title: string; artist: string; artworkUrl: string | null }[];
  /** You own it or are on it already: no card, just open it. */
  alreadyIn: boolean;
  playlistId?: string;
}

export const PREVIEW_PEOPLE = 5;
/** What a dead invite link (off, replaced, or on a playlist no longer
 *  shared) answers, from the join and from the preview alike. */
export const DEAD_LINK = 'This invite link doesn’t work anymore. Ask the owner for a new one.';
export const PREVIEW_SONGS = 3;

/** GET /api/playlists/:id/people: someone the owner could add. `email`
 *  only when the owner is an Ember admin. */
export type CandidatePerson = PlaylistPerson & { email?: string };

/** Most people one playlist can be shared with (the owner not counted). */
export const MAX_MEMBERS = 50;

/** Invite codes: 24 random bytes as base64url, so exactly 32 characters. */
const INVITE_CODE = /^[A-Za-z0-9_-]{32}$/;
/** Looks like a PocketBase record id (15 letters and digits there; any
 *  short run of letters and digits here). Nothing else is ever put into a
 *  filter, so a quote or an operator in a URL cannot change one. */
const RECORD_ID = /^[A-Za-z0-9]{1,64}$/;

/** Only a well-formed code is ever looked up: an empty or odd string must
 *  never reach a filter, where `invite_code = ""` would match every
 *  playlist whose link is off. */
export function isInviteCode(value: unknown): value is string {
  return typeof value === 'string' && INVITE_CODE.test(value);
}

export function isRecordId(value: unknown): value is string {
  return typeof value === 'string' && RECORD_ID.test(value);
}

/** What other people see of someone: the name they chose, never anything
 *  from their email address (tests/README.md, X8). */
export function publicName(user: object | null | undefined): string {
  const raw = (user as { name?: unknown } | null | undefined)?.name;
  const name = typeof raw === 'string' ? raw.trim() : '';
  return name || 'Unnamed member';
}

/** Who the owner's people chip shows: the owner first, then everyone on
 *  it, while it is shared and the sheet's state has loaded; else only you
 *  (and the chip reads "+ Invite"). */
export function chipPeople(
  collaborative: boolean,
  state: CollabState | undefined,
  me: Pick<PlaylistPerson, 'name' | 'avatarUrl'>,
): Pick<PlaylistPerson, 'name' | 'avatarUrl'>[] {
  if (!collaborative || !state?.collaborative) return [me];
  return [state.owner, ...state.members];
}

/** The link that adds whoever opens it (signed in) to the playlist. */
export function inviteUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/playlist/join/${code}`;
}

/** `items` with the one at `from` moved to `to` (both clamped to the list).
 *  A new array; the input is left alone. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const out = [...items];
  if (from < 0 || from >= out.length) return out;
  const target = Math.max(0, Math.min(out.length - 1, Math.trunc(to)));
  const [picked] = out.splice(from, 1);
  out.splice(target, 0, picked);
  return out;
}

/** The moves (the move route's `{ trackId, to }`, applied one after the
 *  other) that turn `current` into `target`: Edit order's Done. Only the
 *  songs off the longest run already in order move, each to just after
 *  the song it follows in `target`, so one song dragged is one request.
 *  Both lists must hold the same songs; otherwise nothing is planned. */
export function planMoves(current: readonly string[], target: readonly string[]): { trackId: string; to: number }[] {
  const at = new Map(current.map((id, i) => [id, i]));
  if (current.length !== target.length || at.size !== current.length || target.some((id) => !at.has(id))) return [];

  // Longest increasing run of current positions, read in target order
  // (patience sorting, O(n log n)): those songs stay where they are.
  const seq = target.map((id) => at.get(id)!);
  const tails: number[] = [];
  const prev = new Array<number>(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < seq[i]) lo = mid + 1;
      else hi = mid;
    }
    prev[i] = lo > 0 ? tails[lo - 1] : -1;
    tails[lo] = i;
  }
  const keep = new Set<string>();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) keep.add(target[i]);

  let list = [...current];
  const moves: { trackId: string; to: number }[] = [];
  target.forEach((id, i) => {
    if (keep.has(id)) return;
    const from = list.indexOf(id);
    const without = list.filter((x) => x !== id);
    const to = i === 0 ? 0 : without.indexOf(target[i - 1]) + 1;
    list = moveItem(list, from, to);
    moves.push({ trackId: id, to });
  });
  return moves;
}
