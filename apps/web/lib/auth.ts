import 'server-only';
import { createClient } from '@/lib/supabase/server';

export class UnauthorizedError extends Error {
  status = 401;
  constructor() {
    super('Unauthorized');
  }
}

/** Returns the current Supabase user or throws UnauthorizedError. */
export async function requireUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) throw new UnauthorizedError();
  return { user: data.user, supabase };
}

export function unauthorizedResponse() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
