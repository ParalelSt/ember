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

/** Server-side admin client. Re-auths each call — cheap (~30ms) at the
 *  scale of "a handful of /api/auth/check-email hits per login session".
 *  Throws status:503 if creds aren't configured so the caller bubbles a
 *  clear error to the UI.
 *
 *  Supports both PB v0.22 (/api/admins/...) and PB v0.23+
 *  (/api/collections/_superusers/...). Tries modern first; falls back on
 *  404 so the same code works against either binary. */
export async function createAdminClient() {
  const pb = new PocketBase(PB_URL);
  const email = process.env.POCKETBASE_ADMIN_EMAIL;
  const password = process.env.POCKETBASE_ADMIN_PASSWORD;
  if (!email || !password) {
    const e = new Error('PocketBase admin credentials not configured');
    (e as { status?: number }).status = 503;
    throw e;
  }
  try {
    await pb.collection('_superusers').authWithPassword(email, password);
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status !== 404) throw err;
    // Legacy v0.22 admin endpoint.
    const res = await fetch(`${PB_URL}/api/admins/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: email, password }),
    });
    if (!res.ok) {
      const e = new Error('Failed to authenticate as PB admin');
      (e as { status?: number }).status = res.status;
      throw e;
    }
    const json = (await res.json()) as { token: string };
    pb.authStore.save(json.token, null);
  }
  return pb;
}
