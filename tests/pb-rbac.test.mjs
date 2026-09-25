/** PocketBase rules, straight through the API a member reaches via /pb
 *  (security audit 2026-09-25, findings S1 and S2).
 *
 *      PB_URL=http://127.0.0.1:8148 \
 *      EMBER_PB_SUPERUSER_EMAIL=... EMBER_PB_SUPERUSER_PASSWORD=... \
 *        node tests/pb-rbac.test.mjs        # or: npm run test:pb-rbac
 *
 *  S1  a list filter or sort that joins into related records (a back-relation
 *      like likes_via_track, or a dotted path like uploader.name) is refused
 *      for members, on lists and on realtime subscriptions. Before the fix,
 *      bob listed alice's likes and history through the shared tracks
 *      catalog, and read her private playlist names through her upload.
 *  S2  an update cannot hand an owned row to someone else: playlists, likes,
 *      plays, recent_searches, and playlist_tracks into another person's
 *      playlist.
 *  Plus the older guards, re-checked: is_admin cannot be set by a member,
 *  and other people's rows stay invisible.
 *
 *  Needs a throwaway PocketBase started from this checkout's migrations and
 *  pb_hooks (tests/README.md, "Security audit sandbox"). Never the live one:
 *  it creates users and rows. The superuser credentials are the sandbox's
 *  own, only used on PB_URL to seed. */
const PB = process.env.PB_URL ?? 'http://127.0.0.1:8148';
const SU_EMAIL = process.env.EMBER_PB_SUPERUSER_EMAIL;
const SU_PASSWORD = process.env.EMBER_PB_SUPERUSER_PASSWORD;
if (!SU_EMAIL || !SU_PASSWORD) {
  console.error('Set EMBER_PB_SUPERUSER_EMAIL and EMBER_PB_SUPERUSER_PASSWORD (the throwaway sandbox superuser).');
  process.exit(2);
}
const PW = 'BugTest2026!';
const json = { 'content-type': 'application/json' };

const out = [];
const check = (name, pass, detail = '') => {
  out.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

async function call(method, path, token, body) {
  const r = await fetch(PB + path, {
    method,
    headers: { ...(body ? json : {}), ...(token ? { Authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await r.json();
  } catch {
    data = null;
  }
  return { status: r.status, data };
}
const list = (col, token, params) => call('GET', `/api/collections/${col}/records?${new URLSearchParams(params)}`, token);

const su = (await call('POST', '/api/admins/auth-with-password', null, { identity: SU_EMAIL, password: SU_PASSWORD })).data?.token;
if (!su) throw new Error(`superuser sign-in on ${PB} failed`);

const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e5)}`;
async function member(label) {
  const email = `${label}-${stamp}@ember.test`;
  const rec = await call('POST', '/api/collections/users/records', su,
    { email, password: PW, passwordConfirm: PW, name: `${label}-${stamp}`, verified: true });
  if (rec.status !== 200) throw new Error(`could not create ${label}: ${JSON.stringify(rec.data)}`);
  const auth = await call('POST', '/api/collections/users/auth-with-password', null, { identity: email, password: PW });
  return { id: rec.data.id, email, token: auth.data.token };
}
const alice = await member('alice');
const bob = await member('bob');

async function track(title) {
  const id = `sec${stamp}${Math.floor(Math.random() * 1e6)}`;
  const r = await call('POST', '/api/collections/tracks/records', su,
    { external_id: `youtube:${id}`, source: 'youtube', source_id: id, title });
  return r.data.id;
}
const secretTrack = await track(`Secret ${stamp}`);
const plantTrack = await track(`Planted ${stamp}`);
const otherTrack = await track(`Other ${stamp}`);

// alice's private things, written the way the app writes them
const alicePl = (await call('POST', '/api/collections/playlists/records', alice.token,
  { user: alice.id, name: `Diary ${stamp}` })).data.id;
await call('POST', '/api/collections/playlist_tracks/records', alice.token, { playlist: alicePl, track: secretTrack, position: 1 });
await call('POST', '/api/collections/likes/records', alice.token, { user: alice.id, track: secretTrack });
await call('POST', '/api/collections/plays/records', alice.token,
  { user: alice.id, track: secretTrack, played_at: '2026-09-25 10:00:00.000Z' });
// a shared upload of hers: the path from a shared row to its owner
await call('POST', '/api/collections/uploads/records', su, { uploader: alice.id, title: `Upload ${stamp}`, filename: 'x.mp3' });

// ── S1: joins in filters and sorts ─────────────────────────────────────────
const refused = (r) => r.status === 400 && !r.data?.items;
const leaked = (r) => (r.data?.items ?? []).length > 0;
for (const [name, col, params] of [
  ['likes through the tracks catalog', 'tracks', { filter: `likes_via_track.user ?= "${alice.id}"` }],
  ['history through the tracks catalog', 'tracks', { filter: `plays_via_track.user ?= "${alice.id}"` }],
  ['playlist contents through the tracks catalog', 'tracks', { filter: `playlist_tracks_via_track.playlist.user ?= "${alice.id}"` }],
  ['playlist names through an upload', 'uploads', { filter: `uploader.playlists_via_user.name ?~ "Diary"` }],
  ['the owner name through an upload', 'uploads', { filter: `uploader.name ~ "alice"` }],
  ['is_admin through an upload', 'uploads', { filter: 'uploader.is_admin = false' }],
  ['a sort on the owner', 'uploads', { sort: '-uploader.name' }],
  ['a join hidden after a quoted string', 'tracks', { filter: `title != "x\\" y" && likes_via_track.user ?= "${alice.id}"` }],
  ['a join with odd case', 'tracks', { filter: `likes_VIA_track.user ?= "${alice.id}"` }],
]) {
  const r = await list(col, bob.token, params);
  check(`S1 bob cannot read alice's ${name}`, refused(r) && !leaked(r), `status ${r.status}, ${(r.data?.items ?? []).length} row(s)`);
}
const anonJoin = await list('tracks', null, { filter: `likes_via_track.user ?= "${alice.id}"` });
check('S1 a signed-out caller is refused too', anonJoin.status === 400, `status ${anonJoin.status}`);

// What the app itself sends still works.
const own = await list('likes', alice.token, { filter: `user = "${alice.id}"`, sort: '-created' });
check('S1 a plain own-field filter still works', own.status === 200 && own.data.items.length === 1, `status ${own.status}`);
const inbox = await list('pranks', alice.token, { filter: `target = "${alice.id}" && status = "pending"`, sort: 'created' });
check('S1 the prank inbox list filter still works', inbox.status === 200, `status ${inbox.status}`);
const dotInString = await list('tracks', alice.token, { filter: `title = "a.b" || title ~ "Secret ${stamp}"` });
check('S1 a dot inside a quoted value is not a join', dotInString.status === 200 && dotInString.data.items.length === 1,
  `status ${dotInString.status}`);
const suJoin = await list('tracks', su, { filter: `likes_via_track.user ?= "${alice.id}"` });
check('S1 the superuser (the server) may still join', suJoin.status === 200 && suJoin.data.items.length === 1, `status ${suJoin.status}`);

// Realtime: the same filter as a subscription option.
async function subscribe(token, topics) {
  const ctl = new AbortController();
  const res = await fetch(`${PB}/api/realtime`, { signal: ctl.signal });
  const reader = res.body.getReader();
  let buf = '';
  let clientId = null;
  while (!clientId) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += new TextDecoder().decode(value);
    const m = /"clientId":"([^"]+)"/.exec(buf);
    if (m) clientId = m[1];
  }
  const r = await call('POST', '/api/realtime', token, { clientId, subscriptions: topics });
  ctl.abort();
  return r.status;
}
const opt = (filter) => `tracks/*?options=${encodeURIComponent(JSON.stringify({ query: { filter } }))}`;
const rtBad = await subscribe(bob.token, [opt(`likes_via_track.user ?= "${alice.id}"`)]);
check('S1 a realtime subscription with a join is refused', rtBad === 400, `status ${rtBad}`);
const rtOk = await subscribe(alice.token, [
  `pranks/*?options=${encodeURIComponent(JSON.stringify({ query: { filter: `target = "${alice.id}" && status = "pending"` } }))}`,
]);
check('S1 the prank inbox subscription still works', rtOk === 204, `status ${rtOk}`);

// ── S2: an update cannot change the owner ──────────────────────────────────
const bobPl = (await call('POST', '/api/collections/playlists/records', bob.token, { user: bob.id, name: 'Spam' })).data.id;
let r = await call('PATCH', `/api/collections/playlists/records/${bobPl}`, bob.token, { user: alice.id });
check('S2 bob cannot hand a playlist to alice', r.status >= 400, `status ${r.status}`);
r = await call('PATCH', `/api/collections/playlists/records/${bobPl}`, bob.token, { 'user+': alice.id });
check('S2 nor with the user+ modifier', r.status >= 400 || r.data?.user === bob.id, `status ${r.status}`);
const alicePls = await list('playlists', alice.token, {});
check('S2 alice sees only her own playlist', alicePls.data.items.length === 1, alicePls.data.items.map((p) => p.name).join(', '));
r = await call('PATCH', `/api/collections/playlists/records/${bobPl}`, bob.token, { name: 'Renamed' });
check('S2 renaming your own playlist still works', r.status === 200 && r.data.name === 'Renamed', `status ${r.status}`);
r = await call('PATCH', `/api/collections/playlists/records/${bobPl}`, bob.token, { user: bob.id, name: 'Same owner' });
check('S2 sending your own id as the owner still works', r.status === 200, `status ${r.status}`);

const bobLike = (await call('POST', '/api/collections/likes/records', bob.token, { user: bob.id, track: plantTrack })).data.id;
r = await call('PATCH', `/api/collections/likes/records/${bobLike}`, bob.token, { user: alice.id });
check('S2 bob cannot move a like onto alice', r.status >= 400, `status ${r.status}`);
const bobPlay = (await call('POST', '/api/collections/plays/records', bob.token,
  { user: bob.id, track: plantTrack, played_at: '2026-09-25 11:00:00.000Z' })).data.id;
r = await call('PATCH', `/api/collections/plays/records/${bobPlay}`, bob.token, { user: alice.id });
check('S2 bob cannot move a play into alice\'s history', r.status >= 400, `status ${r.status}`);
const bobRecent = (await call('POST', '/api/collections/recent_searches/records', bob.token,
  { user: bob.id, track: plantTrack, played_at: '2026-09-25 11:00:00.000Z' })).data?.id;
r = await call('PATCH', `/api/collections/recent_searches/records/${bobRecent}`, bob.token, { user: alice.id });
check('S2 bob cannot move a recent search onto alice', r.status >= 400, `status ${r.status}`);

// A playlist of its own, so this part never depends on the one above.
const bobPl2 = (await call('POST', '/api/collections/playlists/records', bob.token, { user: bob.id, name: 'Mine' })).data.id;
const bobPt = (await call('POST', '/api/collections/playlist_tracks/records', bob.token,
  { playlist: bobPl2, track: plantTrack, position: 1 })).data.id;
r = await call('PATCH', `/api/collections/playlist_tracks/records/${bobPt}`, bob.token, { playlist: alicePl });
check('S2 bob cannot move a song into alice\'s playlist', r.status >= 400, `status ${r.status}`);
r = await call('POST', '/api/collections/playlist_tracks/records', bob.token, { playlist: alicePl, track: otherTrack, position: 2 });
check('S2 nor add one to it directly', r.status >= 400, `status ${r.status}`);
r = await call('PATCH', `/api/collections/playlist_tracks/records/${bobPt}`, bob.token, { position: 7 });
check('S2 reordering your own playlist still works', r.status === 200 && r.data.position === 7, `status ${r.status}`);
const aliceRows = await list('playlist_tracks', alice.token, { filter: `playlist = "${alicePl}"` });
check('S2 alice\'s playlist still holds only her song', aliceRows.data.items.length === 1, `${aliceRows.data.items.length} row(s)`);
const aliceLikes = await list('likes', alice.token, {});
check('S2 alice\'s likes hold only her like', aliceLikes.data.items.length === 1, `${aliceLikes.data.items.length} like(s)`);

// ── the older guards, re-checked ───────────────────────────────────────────
r = await call('PATCH', `/api/collections/users/records/${bob.id}`, bob.token, { is_admin: true });
check('G1 a member cannot make themselves admin', r.status === 403, `status ${r.status}`);
r = await call('PATCH', `/api/collections/users/records/${alice.id}`, bob.token, { name: 'pwned' });
check('G2 a member cannot edit someone else\'s account', r.status === 404, `status ${r.status}`);
const invite = `newbie-${stamp}@ember.test`;
await call('POST', '/api/collections/allowed_emails/records', su, { email: invite });
r = await call('POST', '/api/collections/users/records', null, { email: invite, password: PW, passwordConfirm: PW, is_admin: true });
check('G3 signing up with is_admin set is refused', r.status === 403, `status ${r.status}`);
r = await list('users', bob.token, {});
check('G4 a member lists only their own account', r.data.items.length === 1 && r.data.items[0].id === bob.id, `${r.data.items.length} user(s)`);
r = await list('allowed_emails', bob.token, {});
check('G5 the invite list is closed to members', (r.data?.items ?? []).length === 0, `status ${r.status}`);
r = await list('plays', bob.token, { filter: `user = "${alice.id}"` });
check('G6 alice\'s plays are not listable by bob', (r.data?.items ?? []).length === 0, `${(r.data?.items ?? []).length} row(s)`);
for (const col of ['app_settings', 'prank_sounds', 'prank_schedules', 'tab_lookups', 'import_jobs']) {
  r = await list(col, bob.token, {});
  check(`G7 ${col} shows a member nothing of anyone else's`, (r.data?.items ?? []).length === 0, `status ${r.status}`);
}

const failed = out.filter((c) => !c.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
process.exit(failed.length ? 1 : 0);
