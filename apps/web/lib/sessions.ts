import 'server-only';
import type PocketBase from 'pocketbase';
import type { RecordModel } from 'pocketbase';
import { ForbiddenError } from '@/lib/auth';
import { createCatalogClient } from '@/lib/pocketbase/server';
import { fileUrl } from '@/lib/pocketbase/fileUrl';
import { publicName } from '@/lib/collab';
import type { PlaylistPerson } from '@/types/track';

/** Unambiguous join-code alphabet (no 0/O/1/I). */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newSessionCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

/** The client every carlist route reads and writes session rows with.
 *  Members cannot write those rows themselves, nor see a carlist they have
 *  not joined (bughunt X2, pb_hooks/ensure_sessions.pb.js), so each route
 *  checks host or membership first and then uses the server's own login. */
export function sessionsClient(): Promise<PocketBase> {
  return createCatalogClient();
}

interface StatusError extends Error {
  status?: number;
}

export async function loadSession(pb: PocketBase, id: string): Promise<RecordModel> {
  let row: RecordModel;
  try {
    row = await pb.collection('sessions').getOne(id, { expand: 'host' });
  } catch {
    const e: StatusError = new Error('Session not found.');
    e.status = 404;
    throw e;
  }
  return endIfExpired(pb, row);
}

export function assertActive(session: RecordModel): void {
  if (session.active !== true) {
    const e: StatusError = new Error('This session has ended.');
    e.status = 410;
    throw e;
  }
}

export function assertHost(session: RecordModel, userId: string): void {
  if (session.host !== userId) throw new ForbiddenError();
}

/** Add someone to a session's roster. Idempotent, the unique index makes a
 *  repeat join a no-op rather than an error. */
export async function addMember(
  pb: PocketBase,
  sessionId: string,
  userId: string,
): Promise<void> {
  try {
    await pb.collection('session_members').create({ session: sessionId, user: userId });
  } catch (e) {
    // Already on the roster (the unique index, 400), or an older server whose
    // hook hasn't created the collection yet (404). Neither is worth failing
    // the join over. Anything else (PocketBase down, a 5xx) is: reporting a
    // join that did not happen only gets the joiner a 403 on every poll.
    const status = (e as { status?: number } | undefined)?.status;
    if (status !== 400 && status !== 404) throw e;
  }
}

/** Everyone in a carlist is a DJ, but only people who actually joined are in
 *  the carlist. Knowing the session id is not membership. */
export async function assertMember(
  pb: PocketBase,
  session: RecordModel,
  userId: string,
): Promise<void> {
  if (session.host === userId) return;
  try {
    await pb
      .collection('session_members')
      .getFirstListItem(`session = "${session.id}" && user = "${userId}"`);
  } catch {
    throw new ForbiddenError('Join this session with its code first.');
  }
}

/** Someone in a carlist as the others see them: the name they chose (the
 *  same "Unnamed member" fallback as collaborative playlists, never their
 *  email) and their picture. */
export function carlistPerson(user: RecordModel | Record<string, unknown> | null | undefined, id?: string): PlaylistPerson {
  const u = (user ?? {}) as Record<string, unknown>;
  const avatar = typeof u.avatar === 'string' ? u.avatar : '';
  const userId = String(u.id ?? id ?? '');
  return {
    id: userId,
    name: publicName(u),
    avatarUrl: avatar ? (fileUrl(u, avatar) || null) : null,
  };
}

/** A carlist is over once nobody has moved it on (song change, start) for
 *  this long: hosts often just close the app instead of ending it. The
 *  Carlist button stops showing it and the server stops serving it (join,
 *  poll, add, skip, now, commands) after the same window, measured from the
 *  session row's `updated`, so a long drive that keeps changing songs stays
 *  alive. */
export const LIVE_WINDOW_MS = 12 * 60 * 60 * 1000;

/** Milliseconds since a PocketBase timestamp ("2026-10-02 12:00:00.000Z"),
 *  null when it does not parse. */
export function msSince(stamp: unknown, now = Date.now()): number | null {
  if (typeof stamp !== 'string' || !stamp) return null;
  const t = Date.parse(stamp.replace(' ', 'T'));
  return Number.isFinite(t) ? Math.max(0, now - t) : null;
}

/** True when an active carlist has been idle longer than LIVE_WINDOW_MS. A
 *  row with no parseable `updated` is never expired. */
export function sessionExpired(session: RecordModel, now = Date.now()): boolean {
  if (session.active !== true) return false;
  const idle = msSince(session.updated, now);
  return idle !== null && idle > LIVE_WINDOW_MS;
}

/** Lazy expiry: an expired carlist is marked ended in the DB the first time
 *  it is seen, and handed back as ended, so every route treats it like one
 *  the host ended. */
export async function endIfExpired(
  pb: PocketBase,
  session: RecordModel,
  now = Date.now(),
): Promise<RecordModel> {
  if (!sessionExpired(session, now)) return session;
  await pb.collection('sessions').update(session.id, { active: false }).catch(() => undefined);
  session.active = false;
  return session;
}
