/** End-to-end test for the two playback-privacy switches.
 *
 *      node tests/privacy.test.mjs      # or: npm run test:privacy
 *
 *  Needs the sandbox from tests/README.md (PB on 8091, app on 3005).
 *
 *  The point of these checks is that hiding is enforced by the SERVER. A UI
 *  that merely declines to render a hidden user is not privacy — the data is
 *  still in the response for anyone who opens the network tab. So every
 *  assertion here reads the raw API. */
import assert from 'node:assert';

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8091';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3005';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL ?? 'admin@ember.com';
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD ?? 'egKa5WNMx3QpuG7';
const PASSWORD = 'BugTest2026!';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

async function adminToken() {
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const res = await fetch(`${PB_URL}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: PB_ADMIN_EMAIL, password: PB_ADMIN_PASSWORD }),
    });
    if (res.ok) return (await res.json()).token;
  }
  throw new Error('could not authenticate as PB admin');
}
const token = await adminToken();

async function makeUser(label) {
  const email = `${label}-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
  const res = await fetch(`${PB_URL}/api/collections/users/records`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: token },
    body: JSON.stringify({
      email, password: PASSWORD, passwordConfirm: PASSWORD,
      name: label, verified: true, emailVisibility: true,
    }),
  });
  if (!res.ok) throw new Error(`create ${label}: ${res.status} ${await res.text()}`);
  const rec = await res.json();
  const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: email, password: PASSWORD }),
  }).then((r) => r.json());
  return {
    id: rec.id,
    name: label,
    cookie: `pb_auth=${encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }))}`,
  };
}

/** Give a user a play recorded "just now", so they'd appear in /api/listening. */
async function recordPlay(user, title) {
  const track = await fetch(`${PB_URL}/api/collections/tracks/records`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: token },
    body: JSON.stringify({
      external_id: `youtube:priv${Math.floor(Math.random() * 1e9)}`,
      source: 'youtube', source_id: 'priv', title, artist: 'Privacy Test', duration_sec: 100,
    }),
  }).then((r) => r.json());
  const res = await fetch(`${PB_URL}/api/collections/plays/records`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: token },
    body: JSON.stringify({
      user: user.id, track: track.id,
      played_at: new Date().toISOString().replace('T', ' ').replace('Z', 'Z'),
    }),
  });
  if (!res.ok) throw new Error(`recordPlay: ${res.status} ${await res.text()}`);
}

const getJson = (path, cookie) =>
  fetch(`${APP_URL}${path}`, { headers: cookie ? { cookie } : {} }).then(async (r) => ({
    status: r.status, body: await r.json().catch(() => null),
  }));

const patchPrivacy = (cookie, patch) =>
  fetch(`${APP_URL}/api/privacy`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(patch),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

// ── setup ─────────────────────────────────────────────────────────────────
const alice = await makeUser('alice');
const bob = await makeUser('bob');
await recordPlay(alice, 'Alice Song');

// ── defaults ──────────────────────────────────────────────────────────────
const defaults = await getJson('/api/privacy', alice.cookie);
check('A1 defaults to sharing (existing users must not vanish)',
  defaults.body?.shareDiscord === true && defaults.body?.shareListening === true,
  JSON.stringify(defaults.body));

const visible = await getJson('/api/listening', bob.cookie);
check('A2 alice is visible to bob by default',
  (visible.body?.items ?? []).some((i) => i.track?.title === 'Alice Song'));

// ── hiding from the friends tab ───────────────────────────────────────────
const off = await patchPrivacy(alice.cookie, { shareListening: false });
check('B1 toggle saves', off.status === 200 && off.body?.shareListening === false, JSON.stringify(off.body));

const hidden = await getJson('/api/listening', bob.cookie);
check('B2 alice is gone from the API response, not just the UI',
  !(hidden.body?.items ?? []).some((i) => i.track?.title === 'Alice Song'),
  `${(hidden.body?.items ?? []).length} item(s) returned`);

// Independence matters: someone may want Discord off but friends on, or vice
// versa. A single shared flag would be a quiet privacy bug.
check('B3 hiding from friends left Discord sharing alone', off.body?.shareDiscord === true);

// A newer play must not resurrect a hidden user.
await recordPlay(alice, 'Alice Song Two');
const stillHidden = await getJson('/api/listening', bob.cookie);
check('B4 a fresh play does not resurrect a hidden user',
  !(stillHidden.body?.items ?? []).some((i) => String(i.track?.title).startsWith('Alice Song')));

// ── the Discord switch ────────────────────────────────────────────────────
const dOff = await patchPrivacy(alice.cookie, { shareDiscord: false });
check('C1 discord toggle saves', dOff.body?.shareDiscord === false);

const pushHidden = await fetch(`${APP_URL}/api/discord/update`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: alice.cookie },
  body: JSON.stringify({ track: { title: 'Secret', artist: 'X' }, isPlaying: true }),
}).then((r) => r.json());
check('C2 server refuses to broadcast for an opted-out user', pushHidden?.shared === false,
  JSON.stringify(pushHidden));

await patchPrivacy(alice.cookie, { shareDiscord: true });
const pushShared = await fetch(`${APP_URL}/api/discord/update`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: alice.cookie },
  body: JSON.stringify({ track: { title: 'Public', artist: 'X' }, isPlaying: true }),
}).then((r) => r.json());
check('C3 broadcasts again once re-enabled', pushShared?.shared === true, JSON.stringify(pushShared));

const anonPush = await fetch(`${APP_URL}/api/discord/update`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ track: { title: 'Anon', artist: 'X' }, isPlaying: true }),
}).then((r) => r.json());
check('C4 no session → treated as opted out', anonPush?.shared === false, JSON.stringify(anonPush));

// ── the switches are per-user ─────────────────────────────────────────────
const bobSettings = await getJson('/api/privacy', bob.cookie);
check('D1 alice hiding did not change bob',
  bobSettings.body?.shareDiscord === true && bobSettings.body?.shareListening === true,
  JSON.stringify(bobSettings.body));

await recordPlay(bob, 'Bob Song');
const aliceView = await getJson('/api/listening', alice.cookie);
check('D2 bob still visible to alice', (aliceView.body?.items ?? []).some((i) => i.track?.title === 'Bob Song'));

// ── auth + validation ─────────────────────────────────────────────────────
const anonGet = await fetch(`${APP_URL}/api/privacy`, { redirect: 'manual' });
check('E1 settings need a session', anonGet.status === 401 || anonGet.status === 307, `status ${anonGet.status}`);

const junk = await patchPrivacy(alice.cookie, { nonsense: true });
check('E2 unrecognised body is rejected, not silently accepted', junk.status === 400, `status ${junk.status}`);

// Turning it back on must actually restore visibility.
await patchPrivacy(alice.cookie, { shareListening: true });
const restored = await getJson('/api/listening', bob.cookie);
check('E3 re-enabling restores visibility',
  (restored.body?.items ?? []).some((i) => String(i.track?.title).startsWith('Alice Song')));

// ── cleanup ───────────────────────────────────────────────────────────────
for (const u of [alice, bob]) {
  await fetch(`${PB_URL}/api/collections/users/records/${u.id}`, {
    method: 'DELETE', headers: { Authorization: token },
  }).catch(() => {});
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map((r) => r.name).join(', '));
assert.equal(failed.length, 0);
