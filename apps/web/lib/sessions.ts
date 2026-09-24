import 'server-only';
import type PocketBase from 'pocketbase';
import type { RecordModel } from 'pocketbase';
import { ForbiddenError } from '@/lib/auth';
import { createCatalogClient } from '@/lib/pocketbase/server';

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
  try {
    return await pb.collection('sessions').getOne(id);
  } catch {
    const e: StatusError = new Error('Session not found.');
    e.status = 404;
    throw e;
  }
}

/** Display names by user id, for the carlist screen: the name field only,
 *  never an email (bughunt X8). Members cannot read each other's user rows,
 *  so this needs the server client. A member without a name is left out. */
export async function displayNames(pb: PocketBase, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const names = new Map<string, string>();
  if (unique.length === 0) return names;
  const rows = await pb.collection('users').getFullList({
    filter: unique.map((id) => pb.filter('id = {:id}', { id })).join(' || '),
    fields: 'id,name',
  });
  for (const r of rows) {
    const name = String(r.name ?? '').trim();
    if (name) names.set(r.id, name);
  }
  return names;
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

/** Add someone to a session's roster. Idempotent — the unique index makes a
 *  repeat join a no-op rather than an error. */
export async function addMember(
  pb: PocketBase,
  sessionId: string,
  userId: string,
): Promise<void> {
  try {
    await pb.collection('session_members').create({ session: sessionId, user: userId });
  } catch {
    // Already on the roster, or an older server whose hook hasn't created the
    // collection yet. Neither is worth failing the join over.
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
