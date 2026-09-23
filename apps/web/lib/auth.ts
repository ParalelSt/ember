import 'server-only';
import { createHash } from 'node:crypto';
import type PocketBase from 'pocketbase';
import type { RecordModel } from 'pocketbase';
import { createClient } from '@/lib/pocketbase/server';

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
// PocketBase's answer to the token, remembered for a few seconds per token so
// a page's burst of API calls costs one round trip.
const VERIFIED_TTL_MS = 5_000;
const verified = new Map<string, { record: RecordModel; expires: number }>();

/** The server's user record for the client's token, or null when PocketBase
 *  refuses the token. On success the client's auth store holds that record
 *  (never the cookie's copy). Other failures (PocketBase down) throw. */
async function verifiedRecord(pb: PocketBase): Promise<RecordModel | null> {
  const token = pb.authStore.token;
  if (!token || !pb.authStore.isValid) return null;
  const key = createHash('sha256').update(token).digest('hex');
  const now = Date.now();
  const hit = verified.get(key);
  if (hit && hit.expires > now) {
    pb.authStore.save(token, hit.record);
    return hit.record;
  }
  try {
    const { record } = await pb.collection('users').authRefresh();
    if (verified.size > 500) {
      for (const [k, v] of verified) if (v.expires <= now) verified.delete(k);
    }
    verified.set(key, { record, expires: now + VERIFIED_TTL_MS });
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
export async function requireUser(): Promise<{ pb: PocketBase; user: AuthedUser }> {
  const pb = await createClient();
  const record = await verifiedRecord(pb);
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

/** Like requireUser but also asserts is_admin === true. Throws ForbiddenError
 *  otherwise. Callers typically then create an admin-credentials PB client
 *  via createAdminClient() to bypass per-user collection rules. */
export async function requireAdmin(): Promise<{ pb: PocketBase; user: AuthedUser }> {
  const ctx = await requireUser();
  if (!ctx.user.isAdmin) throw new ForbiddenError();
  return ctx;
}

export function unauthorizedResponse() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}

export function forbiddenResponse() {
  return Response.json({ error: 'Forbidden' }, { status: 403 });
}
