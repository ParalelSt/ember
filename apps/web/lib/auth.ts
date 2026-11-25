import 'server-only';
import type PocketBase from 'pocketbase';
import type { RecordModel } from 'pocketbase';
import { createClient } from '@/lib/pocketbase/server';
import { cachedSession, verifySession } from '@/lib/sessionCache';

export class UnauthorizedError extends Error {
  status = 401;
  constructor() {
    super('Unauthorized');
  }
}

export class ForbiddenError extends Error {
  status = 403;
  constructor(message = 'Forbidden') {
    super(message);
  }
}

export interface AuthedUser {
  id: string;
  email: string;
  isAdmin: boolean;
}

// The pb_auth cookie holds a token PocketBase signed AND a copy of the user
// record as plain JSON. Only the token can be trusted: anyone can edit the
// JSON in their own browser (bughunt W01). So the id and admin flag come from
// PocketBase's answer to the token, remembered for a short while per token
// in the memory proxy.ts fills too (lib/sessionCache, where the security
// window is written down), so a request the proxy just checked is not
// checked again.

/** The server's user record for the client's token, or null when PocketBase
 *  refuses the token. On success the client's auth store holds that record
 *  (never the cookie's copy) with the token the client sent. `fresh` skips
 *  the remembered answer and asks PocketBase. Other failures (PocketBase
 *  down) throw. */
async function verifiedRecord(pb: PocketBase, fresh = false): Promise<RecordModel | null> {
  const token = pb.authStore.token;
  if (!token || !pb.authStore.isValid) return null;
  const hit = fresh ? null : cachedSession(token);
  if (hit) {
    pb.authStore.save(token, hit);
    return hit;
  }
  try {
    const { record } = await verifySession(token, async () => {
      const res = await pb.collection('users').authRefresh({ requestKey: null });
      return { record: res.record, token: res.token };
    });
    // The route keeps using the token it came with: the proxy decides when
    // the browser gets a new one.
    pb.authStore.save(token, record);
    return record;
  } catch (e) {
    const status = (e as { status?: number } | undefined)?.status;
    if (status === 401 || status === 403 || status === 404) {
      pb.authStore.clear();
      return null;
    }
    throw e;
  }
}

/** Returns the current PocketBase user or throws UnauthorizedError. The id
 *  and admin flag are PocketBase's, checked against the session token. */
export async function requireUser(fresh = false): Promise<{ pb: PocketBase; user: AuthedUser }> {
  const pb = await createClient();
  const record = await verifiedRecord(pb, fresh);
  if (!record) throw new UnauthorizedError();
  return {
    pb,
    user: {
      id: record.id,
      email: typeof record.email === 'string' ? record.email : '',
      isAdmin: record.is_admin === true,
    },
  };
}

/** The verified user id behind this request's session, or null: signed out,
 *  a token PocketBase refuses, or PocketBase unreachable. Never throws. For
 *  keying throttles on public routes (lib/rateLimit.ts), not for access. */
export async function verifiedUserId(): Promise<string | null> {
  try {
    const record = await verifiedRecord(await createClient());
    return record?.id ?? null;
  } catch {
    return null;
  }
}

/** Like requireUser but also asserts is_admin === true. Throws ForbiddenError
 *  otherwise. Always asks PocketBase, never the remembered answer: a member
 *  whose admin role or session was just taken away is refused at once.
 *  Callers typically then create an admin-credentials PB client via
 *  createAdminClient() to bypass per-user collection rules. */
export async function requireAdmin(): Promise<{ pb: PocketBase; user: AuthedUser }> {
  const ctx = await requireUser(true);
  if (!ctx.user.isAdmin) throw new ForbiddenError();
  return ctx;
}

/** Whether `user` (from requireUser) holds the admin role right now. Use
 *  it wherever is_admin grants a power outside requireAdmin: requireUser's
 *  flag can be up to the session cache window old (lib/sessionCache), so a
 *  remembered admin is asked about again, fresh. A member is answered
 *  without asking. Never throws: no answer is no power. */
export async function adminNow(user: AuthedUser): Promise<boolean> {
  if (!user.isAdmin) return false;
  try {
    const fresh = await requireUser(true);
    return fresh.user.id === user.id && fresh.user.isAdmin;
  } catch {
    return false;
  }
}

export function unauthorizedResponse() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}

export function forbiddenResponse() {
  return Response.json({ error: 'Forbidden' }, { status: 403 });
}
