/** Carlist sessions: who is actually in the car?
 *
 *      node tests/session-authorization.test.mjs   # or: npm run test:sessions
 *
 *  Everyone in a carlist is a DJ — that's the feature. The bug this guards is
 *  the step before it: a logged-in member who never joined could queue tracks
 *  and skip songs on someone else's session just by knowing its id. Membership
 *  is now recorded at join time, and the routes check it.
 *
 *  Needs the sandbox from tests/README.md (PB on 8091, app on 3010).
 *  Every user is created fresh per run, so it can be re-run freely. */
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

async function user(label) {
  const email = `${label}-${Date.now()}-${Math.floor(Math.random()*1e5)}@ember.test`;
  const rec = await fetch(`${PB}/api/collections/users/records`, { method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: tok },
    body: JSON.stringify({ email, password: PW, passwordConfirm: PW, name: label, verified: true }) })
    .then((r) => r.json());
  const auth = await fetch(`${PB}/api/collections/users/auth-with-password`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PW }) })
    .then((r) => r.json());
  return { id: rec.id, email,
    cookie: `pb_auth=${encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }))}` };
}

const as = (u, path, init = {}) => fetch(APP + path, {
  ...init, redirect: 'manual',
  headers: { ...(init.headers || {}), cookie: u.cookie, ...(init.body ? { 'content-type': 'application/json' } : {}) },
});
const status = (r) => r.status;
const forbidden = (s) => s === 401 || s === 403 || s === 404 || s === 307;
const song = (videoId, title) => ({ id: `youtube:${videoId}`, source: 'youtube', sourceId: videoId, title,
  artist: 'A', artistId: null, album: null, albumId: null, durationSec: 200, artworkUrl: null,
  streamUrl: `/api/youtube/stream/${videoId}` });

const host = await user('host');
const passenger = await user('passenger');
const outsider = await user('outsider');

// ── the host starts a carlist ─────────────────────────────────────────────
const made = await as(host, '/api/sessions', { method: 'POST', body: JSON.stringify({ name: 'Road trip' }) })
  .then((r) => r.json());
const sid = made.session?.id;
const code = made.session?.code;
check('A1 host can start a session', Boolean(sid && code), `code ${code}`);
check('A2 host reads their own session state', (await as(host, `/api/sessions/${sid}`).then(status)) === 200);

// ── a passenger who joins with the code is a full DJ ──────────────────────
const joined = await as(passenger, '/api/sessions/join', { method: 'POST', body: JSON.stringify({ code }) })
  .then(status);
check('B1 passenger joins with the code', joined === 200, `status ${joined}`);
const pAdd = await as(passenger, `/api/sessions/${sid}/tracks`,
  { method: 'POST', body: JSON.stringify({ track: song('dQw4w9WgXcQ', 'Passenger pick') }) }).then(status);
check('B2 passenger can queue a track', pAdd === 201, `status ${pAdd}`);
const pSkip = await as(passenger, `/api/sessions/${sid}/skip`, { method: 'POST' }).then(status);
check('B3 passenger can skip', pSkip === 201, `status ${pSkip}`);
const pState = await as(passenger, `/api/sessions/${sid}`).then(status);
check('B4 passenger can read the session', pState === 200, `status ${pState}`);
const pSave = await as(passenger, `/api/sessions/${sid}/save`, { method: 'POST', body: JSON.stringify({ name: 'Mix' }) })
  .then(status);
check('B5 passenger can save the mix', pSave === 201, `status ${pSave}`);
const reJoin = await as(passenger, '/api/sessions/join', { method: 'POST', body: JSON.stringify({ code }) }).then(status);
check('B6 re-joining is a no-op, not an error', reJoin === 200, `status ${reJoin}`);

// ── somebody who never joined, holding only the id ────────────────────────
const oAdd = await as(outsider, `/api/sessions/${sid}/tracks`,
  { method: 'POST', body: JSON.stringify({ track: song('kJQP7kiw5Fk', 'Outsider pick') }) }).then(status);
check('C1 non-member cannot queue a track', forbidden(oAdd), `status ${oAdd}`);
const oSkip = await as(outsider, `/api/sessions/${sid}/skip`, { method: 'POST' }).then(status);
check('C2 non-member cannot skip', forbidden(oSkip), `status ${oSkip}`);
const oState = await as(outsider, `/api/sessions/${sid}`).then(status);
check('C3 non-member cannot read the session (it leaks the join code)', forbidden(oState), `status ${oState}`);
const oSave = await as(outsider, `/api/sessions/${sid}/save`, { method: 'POST', body: JSON.stringify({ name: 'Mine' }) })
  .then(status);
check('C4 non-member cannot save the queue', forbidden(oSave), `status ${oSave}`);
const oEnd = await as(outsider, `/api/sessions/${sid}/end`, { method: 'POST' }).then(status);
check('C5 non-member cannot end the session', forbidden(oEnd), `status ${oEnd}`);
const oNow = await as(outsider, `/api/sessions/${sid}/now`, { method: 'POST', body: JSON.stringify({ index: 3 }) })
  .then(status);
check('C6 non-member cannot move the playhead', forbidden(oNow), `status ${oNow}`);
const oConsume = await as(outsider, `/api/sessions/${sid}/commands/consume`, { method: 'POST' }).then(status);
check('C7 non-member cannot drain the command queue', forbidden(oConsume), `status ${oConsume}`);

// a joined passenger is still not the host
const pEnd = await as(passenger, `/api/sessions/${sid}/end`, { method: 'POST' }).then(status);
check('C8 passenger cannot end someone else’s session', forbidden(pEnd), `status ${pEnd}`);

// The outsider's track never reached the queue. Compare on video id, not
// title — a track already in the library keeps its stored title.
const queue = await as(host, `/api/sessions/${sid}`).then((r) => r.json()).catch(() => ({}));
const ids = (queue.queue ?? []).map((q) => q.track?.sourceId);
check('C9 the outsider’s track is not in the queue', !ids.includes('kJQP7kiw5Fk'), ids.join(', ') || 'empty');
check('C10 the passenger’s track is', ids.includes('dQw4w9WgXcQ'), ids.join(', ') || 'empty');

// ── seeding a session reads a playlist, so it has to be yours ─────────────
const pl = await as(host, '/api/playlists', { method: 'POST', body: JSON.stringify({ name: 'Host private' }) })
  .then((r) => r.json());
const plId = pl.playlist?.id;
await as(host, `/api/playlists/${plId}/tracks`,
  { method: 'POST', body: JSON.stringify({ track: song('9bZkp7q19f0', 'Host secret') }) });

const stolen = await as(outsider, '/api/sessions',
  { method: 'POST', body: JSON.stringify({ name: 'Steal', seedPlaylistId: plId }) });
check('D1 cannot seed a session from someone else’s playlist', forbidden(stolen.status), `status ${stolen.status}`);
if (stolen.status === 201) {
  const body = await stolen.json().catch(() => ({}));
  const leaked = await as(outsider, `/api/sessions/${body.session?.id}`).then((r) => r.json()).catch(() => ({}));
  check('D2 …and the tracks did not leak', !(leaked.queue ?? []).some((q) => q.track?.sourceId === '9bZkp7q19f0'));
} else {
  const own = await as(host, '/api/sessions', { method: 'POST', body: JSON.stringify({ name: 'Mine', seedPlaylistId: plId }) })
    .then((r) => r.json());
  const seeded = await as(host, `/api/sessions/${own.session?.id}`).then((r) => r.json()).catch(() => ({}));
  check('D2 seeding from your own playlist still works',
    (seeded.queue ?? []).some((q) => q.track?.sourceId === '9bZkp7q19f0'), `${(seeded.queue ?? []).length} track(s)`);
}

// ── signed out ────────────────────────────────────────────────────────────
const anon = await fetch(`${APP}/api/sessions/${sid}`, { redirect: 'manual' }).then(status);
check('E1 signed-out cannot read a session', forbidden(anon), `status ${anon}`);
const anonJoin = await fetch(`${APP}/api/sessions/join`, { method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) }).then(status);
check('E2 signed-out cannot join', forbidden(anonJoin), `status ${anonJoin}`);

const failed = out.filter((o) => !o.pass);
console.log(`\n${out.length - failed.length}/${out.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map((f) => f.name).join(', '));
process.exit(failed.length ? 1 : 0);
