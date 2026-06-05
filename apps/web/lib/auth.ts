import 'server-only';
import type PocketBase from 'pocketbase';
import { createClient } from '@/lib/pocketbase/server';

export class UnauthorizedError extends Error {
  status = 401;
  constructor() {
    super('Unauthorized');
  }
}

export class ForbiddenError extends Error {
  status = 403;
  constructor() {
    super('Forbidden');
  }
}

export interface AuthedUser {
  id: string;
  email: string;
  isAdmin: boolean;
}

/** Returns the current PocketBase user or throws UnauthorizedError. */
export async function requireUser(): Promise<{ pb: PocketBase; user: AuthedUser }> {
  const pb = await createClient();
  if (!pb.authStore.isValid || !pb.authStore.record) throw new UnauthorizedError();
  const record = pb.authStore.record;
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
