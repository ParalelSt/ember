/** Access control over HTTP: can a signed-in member give themselves powers
 *  the app never meant them to have? (bughunt W01, W02, W03, W08)
 *
 *      node tests/access-control-ui.test.mjs
 *
 *  Each probe PASSES when the attempt is refused and nothing changed. The F
 *  checks are the everyday flows the fixes must not break.
 *
 *  Needs a throwaway PocketBase (this worktree's hooks and migrations) and
 *  the app built against it. Defaults: PB on 8089, app on 3051, MUSIC_DIR
 *  set on the app so uploads land in the sandbox. Users are created fresh
 *  per run, so it can be re-run freely.
 *
 *  Env overrides: PB_URL, APP_URL, PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD. */
const PB = process.env.PB_URL ?? 'http://127.0.0.1:8089';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:3051';
const PW = 'BugTest2026!';

const out = [];
const check = (name, pass, detail = '') => {
  out.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

async function adminToken() {
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const r = await fetch(PB + p, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        identity: process.env.PB_ADMIN_EMAIL ?? 'admin@ember.com',
        password: process.env.PB_ADMIN_PASSWORD ?? 'egKa5WNMx3QpuG7',
      }),
    });
    if (r.ok) return (await r.json()).token;
  }
  throw new Error('no admin');
}
const tok = await adminToken();
const asSuper = (path, init = {}) =>
  fetch(PB + path, { ...init, headers: { 'content-type': 'application/json', Authorization: tok, ...(init.headers || {}) } });

const cookieOf = (token, record) => `pb_auth=${encodeURIComponent(JSON.stringify({ token, record }))}`;

async function login(email) {
  return fetch(`${PB}/api/collections/users/auth-with-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: email, password: PW }),
  }).then((r) => r.json());
}

async function user(label, isAdmin = false) {
  const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e5)}@ember.test`;
  const rec = await asSuper('/api/collections/users/records', {
    method: 'POST',
    body: JSON.stringify({ email, password: PW, passwordConfirm: PW, name: label, verified: true, is_admin: isAdmin }),
  }).then((r) => r.json());
  const auth = await login(email);
  return { id: rec.id, email, token: auth.token, record: auth.record, cookie: cookieOf(auth.token, auth.record) };
}

const fresh = async (id) => asSuper(`/api/collections/users/records/${id}`).then((r) => r.json());

const alice = await user('alice');
const boss = await user('boss', true);

const as = (u, path, init = {}) =>
  fetch(APP + path, {
    ...init,
    redirect: 'manual',
    headers: {
      ...(init.headers || {}),
      cookie: typeof u === 'string' ? u : u.cookie,
      ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}),
    },
  });
// Straight at PocketBase through the app's /pb proxy, the way a browser
// holding its own session token could.
const pbAs = (u, path, init = {}) =>
  fetch(`${APP}/pb${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', Authorization: u.token, ...(init.headers || {}) },
  });

const vid = () => Array.from({ length: 11 }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join('');
const mkTrack = (title) => {
  const id = vid();
  return {
    id: `youtube:${id}`, source: 'youtube', sourceId: id, title, artist: 'A', artistId: null, album: null,
    albumId: null, durationSec: 200, artworkUrl: null, streamUrl: `/api/youtube/stream/${id}`,
  };
};

function makeWav(seconds = 1, sampleRate = 8000) {
  const samples = seconds * sampleRate;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
async function upload(u, title) {
  const fd = new FormData();
  fd.append('file', new Blob([makeWav()], { type: 'audio/wav' }), 'song.wav');
  fd.append('title', title);
  fd.append('artist', 'Tester');
  fd.append('durationSec', '1');
  const r = await fetch(`${APP}/api/uploads`, { method: 'POST', headers: { cookie: u.cookie }, body: fd });
  return { status: r.status, json: await r.json().catch(() => null) };
}

// ── F: everyday flows that must keep working ─────────────────────────────
const song = mkTrack('Plain Song');
const liked = await as(alice, '/api/likes', { method: 'POST', body: JSON.stringify({ track: song }) });
check('F1 like a new song', liked.status === 201, `status ${liked.status} ${liked.status === 201 ? '' : (await liked.text()).slice(0, 120)}`);
const likes = await as(alice, '/api/likes').then((r) => r.json()).catch(() => ({}));
check('F1b the like shows in Liked Songs', (likes.tracks ?? []).some((t) => t.id === song.id));

const played = await as(alice, '/api/history', { method: 'POST', body: JSON.stringify({ track: { ...song, artworkUrl: 'https://i.ytimg.com/vi/x/hq.jpg' } }) });
check('F2 play an existing song (history, with a backfill)', played.status === 201, `status ${played.status}`);
const played2 = await as(alice, '/api/history', { method: 'POST', body: JSON.stringify({ track: mkTrack('Never Seen') }) });
check('F2b play a brand new song', played2.status === 201, `status ${played2.status}`);

const pl = await as(alice, '/api/playlists', { method: 'POST', body: JSON.stringify({ name: 'Mine' }) }).then((r) => r.json());
const added = await as(alice, `/api/playlists/${pl.playlist?.id}/tracks`, { method: 'POST', body: JSON.stringify({ track: mkTrack('For The List') }) });
check('F3 add a new song to a playlist', added.ok, `status ${added.status}`);

const searched = await as(alice, '/api/recent-searches', { method: 'POST', body: JSON.stringify({ track: mkTrack('Searched') }) });
check('F4 remember a searched song', searched.ok, `status ${searched.status}`);

const fd = new FormData();
fd.append('name', 'Alice Renamed');
const prof = await as(alice, '/api/profile', { method: 'PATCH', body: fd });
check('F5 profile edit (name)', prof.ok && (await fresh(alice.id)).name === 'Alice Renamed', `status ${prof.status}`);

const aliceUp = await upload(alice, `Alice Upload ${Date.now()}`);
check('F6 upload a song', aliceUp.status === 201, `status ${aliceUp.status}`);
const bossUp = await upload(boss, `Boss Upload ${Date.now()}`);
const aliceUpId = aliceUp.json?.track?.sourceId;
const bossUpId = bossUp.json?.track?.sourceId;
const streamed = aliceUpId ? await as(alice, `/api/uploads/${aliceUpId}/stream`) : { status: 0 };
check('F6b play the upload', streamed.status === 200 || streamed.status === 206, `status ${streamed.status}`);

const rows = await as(boss, `/api/admin/tracks?q=${encodeURIComponent('Plain Song')}`).then((r) => r.json()).catch(() => ({}));
const row = (rows.tracks ?? []).find((t) => t.id === song.id);
const edited = row ? await as(boss, `/api/admin/tracks/${row.recordId}`, { method: 'PATCH', body: JSON.stringify({ title: 'Plain Song (edited)' }) }) : { status: 0 };
check('F7 an admin edits a track', edited.status === 200, `status ${edited.status}`);

const carol = await user('carol');
const promoted = await as(boss, `/api/admin/users/${carol.id}`, { method: 'PATCH', body: JSON.stringify({ isAdmin: true }) });
check('F8 an admin makes someone an admin', promoted.ok && (await fresh(carol.id)).is_admin === true, `status ${promoted.status}`);

const plainInvite = `newcomer-${Date.now()}@ember.test`;
await asSuper('/api/collections/allowed_emails/records', { method: 'POST', body: JSON.stringify({ email: plainInvite }) });
const joined = await fetch(`${APP}/pb/api/collections/users/records`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: plainInvite, password: PW, passwordConfirm: PW }),
});
check('F9 an invitee signs up', joined.ok, `status ${joined.status}`);

const catalogRow = await asSuper(`/api/collections/tracks/records?filter=${encodeURIComponent(`external_id="${song.id}"`)}`)
  .then((r) => r.json()).then((j) => j.items?.[0]);
check('F2c playing it filled in the missing artwork', catalogRow?.artwork_url === 'https://i.ytimg.com/vi/x/hq.jpg');

// ── W02: promoting yourself through PocketBase ───────────────────────────
const self = await pbAs(alice, `/api/collections/users/records/${alice.id}`, { method: 'PATCH', body: JSON.stringify({ is_admin: true }) });
check('W02a a member cannot make themselves admin', (await fresh(alice.id)).is_admin !== true, `status ${self.status}`);

const inviteEmail = `invitee-${Date.now()}@ember.test`;
await asSuper('/api/collections/allowed_emails/records', { method: 'POST', body: JSON.stringify({ email: inviteEmail }) });
const signup = await fetch(`${APP}/pb/api/collections/users/records`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: inviteEmail, password: PW, passwordConfirm: PW, is_admin: true }),
});
const signed = signup.ok ? await signup.json() : null;
check('W02b a new invitee cannot sign up as admin', !signed || (await fresh(signed.id)).is_admin !== true, `status ${signup.status}`);

// ── W01: a doctored session cookie ───────────────────────────────────────
const forgedAdmin = cookieOf(alice.token, { ...alice.record, is_admin: true });
const adminList = await as(forgedAdmin, '/api/admin/users');
check('W01a a cookie that claims is_admin does not open admin routes', adminList.status === 403, `status ${adminList.status}`);

const forgedId = cookieOf(alice.token, { ...alice.record, id: boss.id });
const theirs = bossUpId ? await as(forgedId, `/api/uploads/${bossUpId}`, { method: 'DELETE' }) : { status: 0 };
const stillThere = bossUpId ? (await asSuper(`/api/collections/uploads/records/${bossUpId}`)).ok : false;
check('W01b a cookie that claims someone else’s id cannot delete their upload', stillThere, `status ${theirs.status}`);

// A token PocketBase never issued (far-future expiry, unsigned) on a path
// ending .js, which the proxy used to wave through without a session.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeJwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ id: boss.id, type: 'authRecord', collectionId: boss.record.collectionId, exp: 4102444800 })}.x`;
const fake = cookieOf(fakeJwt, { ...boss.record, is_admin: true });
const fakeRes = await as(fake, `/api/admin/users/${carol.id}.js`, { method: 'PATCH', body: JSON.stringify({ name: 'forged' }) });
check('W01c a made-up token cannot reach admin code', fakeRes.status === 307 || fakeRes.status === 401, `status ${fakeRes.status}`);
// Signed out, an API path answers 401 JSON (bughunt W05); a `.js` suffix must
// not slip past the proxy's session check and get something else.
const anonJs = await fetch(`${APP}/api/playlists/x.js`, { redirect: 'manual' });
const anonPlain = await fetch(`${APP}/api/playlists/x`, { redirect: 'manual' });
check(
  'W01d signed out, /api/…/x.js is refused like any API path',
  anonJs.status === 401 && anonPlain.status === 401 && (anonJs.headers.get('content-type') ?? '').includes('json'),
  `status ${anonJs.status} (plain ${anonPlain.status})`,
);

// ── W03: rewriting the shared catalog ────────────────────────────────────
const renamed = catalogRow
  ? await pbAs(alice, `/api/collections/tracks/records/${catalogRow.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'HIJACKED' }) })
  : { status: 0 };
const after = catalogRow ? await asSuper(`/api/collections/tracks/records/${catalogRow.id}`).then((r) => r.json()) : {};
check('W03a a member cannot rename a song for everyone', !!catalogRow && after.title !== 'HIJACKED', `status ${renamed.status}`);
const planted = mkTrack('Planted');
const plant = await pbAs(alice, '/api/collections/tracks/records', {
  method: 'POST',
  body: JSON.stringify({ external_id: planted.id, source: 'youtube', source_id: planted.sourceId, title: 'Planted' }),
});
check('W03b a member cannot write catalog rows straight into PocketBase', !plant.ok, `status ${plant.status}`);

// ── W08: pointing your upload at someone else’s file ─────────────────────
const bossFile = bossUpId ? (await asSuper(`/api/collections/uploads/records/${bossUpId}`).then((r) => r.json())).filename : '';
const repoint = aliceUpId
  ? await pbAs(alice, `/api/collections/uploads/records/${aliceUpId}`, { method: 'PATCH', body: JSON.stringify({ filename: bossFile, artwork_ext: 'x' }) })
  : { status: 0 };
const mine = aliceUpId ? await asSuper(`/api/collections/uploads/records/${aliceUpId}`).then((r) => r.json()) : {};
check('W08 an uploader cannot change the stored filename', !!aliceUpId && mine.filename !== bossFile && mine.artwork_ext !== 'x', `status ${repoint.status}`);

const failed = out.filter((r) => !r.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
process.exit(failed.length ? 1 : 0);
