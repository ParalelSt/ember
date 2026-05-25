import { createBrowserClient } from '@supabase/ssr';

/** Browser Supabase client. Reads/writes cookies via `@supabase/ssr` so the
 *  server route handlers can see the same session. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
