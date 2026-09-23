/** PocketBase's superuser surface must not be reachable through the app (bughunt W14).
 *
 *      APP_URL=http://127.0.0.1:3053 PB_URL=http://127.0.0.1:8086 \
 *      EMBER_PB_SUPERUSER_EMAIL=... EMBER_PB_SUPERUSER_PASSWORD=... \
 *        node tests/pb-admin-exposure.test.mjs
 *
 *  The app proxies /pb/* to PocketBase so the browser can sign in and read
 *  its own records on one public URL. Before the fix that proxy forwarded
 *  everything, the superuser sign-in (/api/admins) and the admin UI (/_/)
 *  included, so anyone on the internet could try the superuser password.
 *
 *  Needs a throwaway PocketBase built from this checkout's hooks and
 *  migrations, and the app built against it (see tests/README.md, "W14").
 *  The superuser credentials are the throwaway sandbox's own, passed in the
 *  environment: they are only used against PB_URL directly, to seed a member,
 *  and against the app, to prove the proxy refuses them. */
const APP = process.env.APP_URL ?? 'http://127.0.0.1:3053';
const PB = process.env.PB_URL ?? 'http://127.0.0.1:8086';
const SU_EMAIL = process.env.EMBER_PB_SUPERUSER_EMAIL;
const SU_PASSWORD = process.env.EMBER_PB_SUPERUSER_PASSWORD;
if (!SU_EMAIL || !SU_PASSWORD) {
  console.error('Set EMBER_PB_SUPERUSER_EMAIL and EMBER_PB_SUPERUSER_PASSWORD (the throwaway sandbox superuser).');
  process.exit(2);
}
const PW = 'BugTest2026!';

const out = [];
const check = (name, pass, detail = '') => {
  out.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const json = { 'content-type': 'application/json' };

// ── seed: a superuser token straight from PocketBase, one invited member ──
async function suToken() {
  const r = await fetch(`${PB}/api/admins/auth-with-password`, {
    method: 'POST', headers: json, body: JSON.stringify({ identity: SU_EMAIL, password: SU_PASSWORD }) });
  if (!r.ok) throw new Error(`superuser sign-in on ${PB} failed: ${r.status}`);
  return (await r.json()).token;
}
const tok = await suToken();
check('D1 the superuser still signs in on PocketBase directly (what the server uses)', true);

const email = `w14-${Date.now()}-${Math.floor(Math.random() * 1e5)}@ember.test`;
await fetch(`${PB}/api/collections/allowed_emails/records`, {
  method: 'POST', headers: { ...json, Authorization: tok }, body: JSON.stringify({ email }) });
const created = await fetch(`${PB}/api/collections/users/records`, {
  method: 'POST', headers: { ...json, Authorization: tok },
  body: JSON.stringify({ email, password: PW, passwordConfirm: PW, name: 'w14', verified: true }) });
if (!created.ok) throw new Error(`could not create the test member: ${created.status} ${await created.text()}`);

// ── the superuser surface through the app ─────────────────────────────────
// Redirects are followed: Next folds a trailing or doubled slash with a 308
// first, and what matters is where the request finally lands. A redirect
// loop (the unfixed admin UI bounces between Next and PocketBase) is a fail.
const landed = (p) => p.catch((e) => ({ status: `no answer (${e.cause?.message ?? e.message})`, text: async () => '' }));
const post = (path, body) => landed(fetch(APP + path, { method: 'POST', headers: json, body: JSON.stringify(body) }));
const get = (path) => landed(fetch(APP + path));

const bad = await post('/pb/api/admins/auth-with-password', { identity: 'nobody@example.com', password: 'wrong-password' });
check('A1 superuser sign-in through /pb answers 404 (wrong password)', bad.status === 404, `status ${bad.status}`);

const real = await post('/pb/api/admins/auth-with-password', { identity: SU_EMAIL, password: SU_PASSWORD });
const realBody = await real.text();
check('A2 superuser sign-in through /pb answers 404 even with the right password',
  real.status === 404 && !realBody.includes('"token"'), `status ${real.status}`);

for (const p of ['/pb/api/admins/request-password-reset', '/pb/api/%61dmins/auth-with-password',
  '/pb//api/admins/auth-with-password', '/pb/api/admins%2Fauth-with-password']) {
  const r = await post(p, { identity: SU_EMAIL, password: SU_PASSWORD, email: SU_EMAIL });
  check(`A3 POST ${p} answers 404`, r.status === 404, `status ${r.status}`);
}

for (const p of ['/pb/_/', '/pb/_', '/pb/api/admins', '/pb/api/admins/x.png', '/pb/api/settings',
  '/pb/api/backups', '/pb/api/logs', '/pb/api/collections', '/pb/api/collections/users',
  '/pb/_/images/favicon/favicon-32x32.png', '/pb/_/images/favicon/safari-pinned-tab.svg']) {
  const r = await get(p);
  check(`A4 GET ${p} answers 404`, r.status === 404, `status ${r.status}`);
}

// ── what members use keeps working ────────────────────────────────────────
const health = await get('/pb/api/health');
check('B1 /pb/api/health still answers', health.status === 200, `status ${health.status}`);

const auth = await post('/pb/api/collections/users/auth-with-password', { identity: email, password: PW });
const authBody = await auth.json().catch(() => ({}));
check('B2 member sign-in through /pb still works', auth.status === 200 && !!authBody.token, `status ${auth.status}`);

const cookie = `pb_auth=${encodeURIComponent(JSON.stringify({ token: authBody.token, record: authBody.record }))}`;
const track = { id: 'youtube:dQw4w9WgXcQ', source: 'youtube', sourceId: 'dQw4w9WgXcQ', title: 'W14 Song',
  artist: 'A', artistId: null, album: null, albumId: null, durationSec: 213, artworkUrl: null,
  streamUrl: '/api/youtube/stream/dQw4w9WgXcQ' };
const like = await fetch(`${APP}/api/likes`, { method: 'POST', headers: { ...json, cookie }, body: JSON.stringify({ track }), redirect: 'manual' });
check('B3 liking a song still works', like.status >= 200 && like.status < 300, `status ${like.status}`);
const likes = await fetch(`${APP}/api/likes`, { headers: { cookie }, redirect: 'manual' });
const likesText = await likes.text();
check('B4 the like shows up in the member’s likes', likes.status === 200 && likesText.includes('W14 Song'), `status ${likes.status}`);

const own = await fetch(`${APP}/pb/api/collections/likes/records?perPage=5`, { headers: { Authorization: authBody.token } });
check('B5 reading own records through /pb still works', own.status === 200, `status ${own.status}`);

// The server's own superuser client (POCKETBASE_URL, not /pb) is untouched:
// check-email reads the invite list with it.
const ce = await post('/api/auth/check-email', { email });
const ceBody = await ce.json().catch(() => ({}));
check('B6 the server’s own superuser client still works (check-email)', ce.status === 200 && ceBody.status === 'existing',
  `status ${ce.status} ${JSON.stringify(ceBody)}`);

const failed = out.filter((c) => !c.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
process.exit(failed.length ? 1 : 0);
