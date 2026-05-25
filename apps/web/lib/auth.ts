import 'server-only';
import type PocketBase from 'pocketbase';
import { createClient } from '@/lib/pocketbase/server';

export class UnauthorizedError extends Error {
  status = 401;
  constructor() {
    super('Unauthorized');
  }
}

export interface AuthedUser {
  id: string;
  email: string;
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
    },
  };
}

export function unauthorizedResponse() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
