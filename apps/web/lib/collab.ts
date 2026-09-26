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
