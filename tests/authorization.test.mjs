/** Cross-user authorization: can one member reach another's data?
 *
 *      node tests/authorization.test.mjs   # or: npm run test:auth
 *
 *  Ember is invite-only, but "invited" is not "trusted with everyone else's
 *  library". This walks the surface a logged-in member could poke at: someone
 *  else's playlist, likes and history, plus the admin routes.
 *
 *  Needs the sandbox from tests/README.md (PB on 8091, app on 3010).
 *  Both users are created fresh per run, so it can be re-run freely. */
const PB = 'http://127.0.0.1:8091';
const APP = 'http://127.0.0.1:3010';
const PW = 'BugTest2026!';

const out = [];
const check = (name, pass, detail = '') => {
  out.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

async function adminToken() {
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const r = await fetch(PB + p, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: 'admin@ember.com', password: 'egKa5WNMx3QpuG7' }) });
    if (r.ok) return (await r.json()).token;
  }
  throw new Error('no admin');
}
const tok = await adminToken();

async function user(label, isAdmin = false) {
  const email = `${label}-${Date.now()}-${Math.floor(Math.random()*1e5)}@ember.test`;
  const rec = await fetch(`${PB}/api/collections/users/records`, { method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: tok },
    body: JSON.stringify({ email, password: PW, passwordConfirm: PW, name: label, verified: true, is_admin: isAdmin }) })
    .then((r) => r.json());
  const auth = await fetch(`${PB}/api/collections/users/auth-with-password`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PW }) })
    .then((r) => r.json());
  return { id: rec.id, email,
    cookie: `pb_auth=${encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }))}` };
}

const alice = await user('alice');
const bob = await user('bob');

const as = (u, path, init = {}) => fetch(APP + path, {
  ...init, redirect: 'manual',
  headers: { ...(init.headers || {}), cookie: u.cookie, ...(init.body ? { 'content-type': 'application/json' } : {}) },
});

// Alice creates a private playlist with a track.
const pl = await as(alice, '/api/playlists', { method: 'POST', body: JSON.stringify({ name: 'Alice private' }) })
  .then((r) => r.json());
const plId = pl.playlist?.id;
const track = { id: 'youtube:dQw4w9WgXcQ', source: 'youtube', sourceId: 'dQw4w9WgXcQ', title: 'Secret Song',
  artist: 'A', artistId: null, album: null, albumId: null, durationSec: 213, artworkUrl: null,
  streamUrl: '/api/youtube/stream/dQw4w9WgXcQ' };
await as(alice, `/api/playlists/${plId}/tracks`, { method: 'POST', body: JSON.stringify({ track }) });
await as(alice, '/api/likes', { method: 'POST', body: JSON.stringify({ track }) });
await as(alice, '/api/history', { method: 'POST', body: JSON.stringify({ track }) });
console.log(`alice playlist: ${plId}\n`);

const status = async (r) => r.status;
const forbidden = (s) => s === 403 || s === 404 || s === 401 || s === 307;

// ── another member ────────────────────────────────────────────────────────
check('B1 bob cannot READ alice’s playlist',
  forbidden(await as(bob, `/api/playlists/${plId}`).then(status)),
  `status ${await as(bob, `/api/playlists/${plId}`).then(status)}`);
// Use a track alice does NOT have, so a rejection can't be mistaken for a
// duplicate-entry error — that ambiguity once hid whether the check ran at all.
const intruder = { ...track, id: 'youtube:kJQP7kiw5Fk', sourceId: 'kJQP7kiw5Fk', title: 'BOB WAS HERE' };
const addRes = await as(bob, `/api/playlists/${plId}/tracks`, { method: 'POST', body: JSON.stringify({ track: intruder }) });
const addBody = await addRes.text();
check('B2 bob’s add is refused', forbidden(addRes.status), `status ${addRes.status}`);
check('B2b refusal is a sentence, not a raw store error',
  !/failed to create record/i.test(addBody), addBody.slice(0, 80));
const aliceView = await as(alice, `/api/playlists/${plId}`).then((r) => r.json()).catch(() => ({}));
check('B2c alice’s playlist is untouched',
  !(aliceView.tracks ?? []).some((t) => t.title === 'BOB WAS HERE'),
  (aliceView.tracks ?? []).map((t) => t.title).join(', '));
check('B2d bob cannot remove alice’s track',
  forbidden(await as(bob, `/api/playlists/${plId}/tracks/${encodeURIComponent(track.id)}`, { method: 'DELETE' }).then(status)));
check('B3 bob cannot DELETE alice’s playlist',
  forbidden(await as(bob, `/api/playlists/${plId}`, { method: 'DELETE' }).then(status)),
  `status ${await as(bob, `/api/playlists/${plId}`, { method: 'DELETE' }).then(status)}`);

const bobPlaylists = await as(bob, '/api/playlists').then((r) => r.json()).catch(() => ({}));
check('B4 alice’s playlist is absent from bob’s list',
  !(bobPlaylists.playlists ?? []).some((p) => p.id === plId),
  `${(bobPlaylists.playlists ?? []).length} playlist(s) visible`);

const bobLikes = await as(bob, '/api/likes').then((r) => r.json()).catch(() => ({}));
check('B5 bob’s likes do not include alice’s', !(bobLikes.tracks ?? []).some((t) => t.title === 'Secret Song'),
  `${(bobLikes.tracks ?? []).length} like(s)`);
const bobHistory = await as(bob, '/api/history').then((r) => r.json()).catch(() => ({}));
check('B6 bob’s history does not include alice’s', !(bobHistory.tracks ?? []).some((t) => t.title === 'Secret Song'),
  `${(bobHistory.tracks ?? []).length} play(s)`);

// ── admin surface ─────────────────────────────────────────────────────────
for (const [name, path, init] of [
  ['list users', '/api/admin/users', {}],
  ['list tracks', '/api/admin/tracks', {}],
  ['read logs', '/api/admin/logs', {}],
  ['list invites', '/api/admin/invites', {}],
  ['run cleanup', '/api/admin/cleanup', { method: 'POST', body: JSON.stringify({ apply: true }) }],
]) {
  const s = await as(bob, path, init).then(status);
  check(`C ${name} refused to a normal member`, forbidden(s), `status ${s}`);
}

// ── signed out ────────────────────────────────────────────────────────────
const anon = await fetch(`${APP}/api/playlists`, { redirect: 'manual' }).then(status);
check('D1 signed-out cannot list playlists', forbidden(anon), `status ${anon}`);
const anonUp = await fetch(`${APP}/api/uploads`, { redirect: 'manual' }).then(status);
check('D2 signed-out cannot list uploads', forbidden(anonUp), `status ${anonUp}`);

const failed = out.filter((o) => !o.pass);
console.log(`\n${out.length - failed.length}/${out.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map((f) => f.name).join(', '));
