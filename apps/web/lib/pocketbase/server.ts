import 'server-only';
import PocketBase from 'pocketbase';
import { cookies } from 'next/headers';

// Server side needs an absolute URL. NEXT_PUBLIC_POCKETBASE_URL may be the
// relative `/pb` proxy path (browser-only), so fall back to localhost if it
// isn't absolute.
const RAW_PB_URL =
  process.env.POCKETBASE_URL ??
  process.env.NEXT_PUBLIC_POCKETBASE_URL ??
  'http://127.0.0.1:8090';
const PB_URL = /^https?:\/\//.test(RAW_PB_URL) ? RAW_PB_URL : 'http://127.0.0.1:8090';

/** Server PocketBase client bound to the current request's pb_auth cookie.
 *  Use inside route handlers and server components. */
export async function createClient() {
  const pb = new PocketBase(PB_URL);
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  pb.authStore.loadFromCookie(cookieHeader, 'pb_auth');
  return pb;
}
