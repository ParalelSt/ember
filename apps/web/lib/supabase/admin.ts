import 'server-only';
import { createClient } from '@supabase/supabase-js';

/** Supabase service-role client. Bypasses RLS — only use for trusted writes
 *  (track upserts, server-side verification). Never expose to the client. */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase admin not configured');
  return createClient(url, key, { auth: { persistSession: false } });
}
