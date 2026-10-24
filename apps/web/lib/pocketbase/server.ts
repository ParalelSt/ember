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

/** Server-side admin client. Re-auths each call, cheap (~30ms) at the
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

// Reused admin token for the hot catalog path (every like and play writes the
// shared tracks row). createAdminClient signs in on each call, which is a
// password check per play; this signs in once and reuses the token.
let catalogToken: { token: string; expires: number; checkedAt: number } | null = null;
const CATALOG_TOKEN_TTL_MS = 10 * 60_000;
/** A token PocketBase just confirmed is not asked about again this soon. */
const CATALOG_CHECK_EVERY_MS = 5_000;
let catalogSignIn: Promise<string> | null = null;

/** One sign-in for everyone who needs a new catalog token at the same time. */
function signInCatalog(): Promise<string> {
  catalogSignIn ??= createAdminClient()
    .then((pb) => {
      const now = Date.now();
      catalogToken = { token: pb.authStore.token, expires: now + CATALOG_TOKEN_TTL_MS, checkedAt: now };
      return pb.authStore.token;
    })
    .finally(() => {
      catalogSignIn = null;
    });
  return catalogSignIn;
}

const REFRESH_PATHS = ['/api/collections/_superusers/auth-refresh', '/api/admins/auth-refresh'];
/** The refresh path this PocketBase answered on. Asking the other one first
 *  every time cost a 404, which PocketBase logs as an error, on every check
 *  (one per 5 s while a carlist is hosted). */
let refreshPath: string | null = null;

/** PocketBase's answer to "does this admin token still hold": the status of
 *  an auth refresh (v0.23+ path first, v0.22 on 404, as createAdminClient
 *  does; the one that answered first from then on). 0 when PocketBase could
 *  not be asked. */
async function refreshStatus(token: string): Promise<number> {
  const paths = refreshPath ? [refreshPath, ...REFRESH_PATHS.filter((p) => p !== refreshPath)] : REFRESH_PATHS;
  for (const path of paths) {
    const res = await fetch(`${PB_URL}${path}`, { method: 'POST', headers: { Authorization: token } }).catch(() => null);
    if (!res) return 0;
    await res.body?.cancel().catch(() => {});
    if (res.status !== 404) {
      refreshPath = path;
      return res.status;
    }
  }
  return 404;
}

/** Whether `token` has stopped being an admin token. PocketBase does not
 *  say so on its own: it reads a request with a dead token (after a
 *  restore, or an admin password change, both give the superuser a new
 *  token key) as a guest's, a 404 or an empty list. `refused` is a 401 or
 *  403, which is always worth asking about. */
async function catalogTokenDead(token: string, refused: boolean): Promise<boolean> {
  const cached = catalogToken;
  if (cached && cached.token !== token) return true; // replaced meanwhile
  if (cached && !refused && Date.now() - cached.checkedAt < CATALOG_CHECK_EVERY_MS) return false;
  const status = await refreshStatus(token);
  if (status === 401 || status === 403) return true;
  if (status === 200 && cached && catalogToken === cached) cached.checkedAt = Date.now();
  return false;
}

/** The token to use instead of a dead one: a newer cached one if another
 *  request already signed in again, else a new sign-in. */
async function replacementToken(dead: string): Promise<string> {
  const cached = catalogToken;
  if (cached && cached.token !== dead && cached.expires > Date.now()) return cached.token;
  if (cached?.token === dead) catalogToken = null;
  return signInCatalog();
}

const looksEmpty = (answer: unknown) =>
  !!answer && typeof answer === 'object' && Array.isArray((answer as { items?: unknown }).items) &&
  (answer as { items: unknown[] }).items.length === 0;

/** Every request of this client goes through here. An answer that could be
 *  a dead token reading as a guest (401, 403, 404, an empty list) makes it
 *  check the token; a dead one is replaced, once, and the request sent
 *  again. Any other answer goes straight back: no extra request. */
function guardCatalog(pb: PocketBase): PocketBase {
  if (typeof pb.send !== 'function') return pb;
  const send = pb.send.bind(pb);
  pb.send = (async (path: string, options: Parameters<typeof send>[1]) => {
    // The token this request goes with. Read after the answer, it could be
    // the new one another request on this client has just put in, and the
    // guest answer would be taken as that live token's.
    const token = pb.authStore.token;
    let answer: unknown;
    let failure: unknown = null;
    try {
      answer = await send(path, options);
    } catch (e) {
      failure = e;
    }
    const status = failure ? (failure as { status?: number } | null)?.status : 200;
    const refused = status === 401 || status === 403;
    const suspicious = failure ? refused || status === 404 : looksEmpty(answer);
    if (suspicious && token && (await catalogTokenDead(token, refused))) {
      pb.authStore.save(await replacementToken(token), null);
      return send(path, options);
    }
    if (failure) throw failure;
    return answer;
  }) as typeof pb.send;
  return pb;
}

/** Admin client for writes to the shared tracks catalog, and for the carlist
 *  routes (lib/sessions.ts sessionsClient, polled every 2 s). The reused
 *  token heals itself when it dies (guardCatalog); fresh=true still drops it
 *  outright. A new PocketBase instance per call, so concurrent requests
 *  never share an auth store or cancel each other's requests. */
export async function createCatalogClient(fresh = false): Promise<PocketBase> {
  const cached = catalogToken;
  const token =
    !fresh && cached && cached.expires > Date.now() ? cached.token : await signInCatalog();
  const pb = new PocketBase(PB_URL);
  pb.authStore.save(token, null);
  return guardCatalog(pb);
}
