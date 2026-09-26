/** Collaborative playlists: who may do what, against a throwaway PocketBase
 *  and the app built against it.
 *
 *      PB_URL=http://127.0.0.1:8198 APP_URL=http://127.0.0.1:3170 \
 *      EMBER_PB_SUPERUSER_EMAIL=... EMBER_PB_SUPERUSER_PASSWORD=... \
 *        node tests/collab-rbac.test.mjs        # or: npm run test:collab-rbac
 *
 *  Four people: the OWNER of a collaborative playlist, a MEMBER of it, an
 *  OUTSIDER (on the server, not on the playlist) and an ADMIN (is_admin,
 *  not on the playlist either: being an Ember admin gives nothing here).
 *
 *  P   PocketBase straight through the API (what /pb exposes). Nothing about
 *      collaboration is opened there: a member cannot read, list, subscribe
 *      to or write someone else's playlist or its songs; nobody but the
 *      server reads or writes playlist_members; the owner cannot set
 *      collaborative, invite_code or someone else's added_by; joins in
 *      filters stay refused (S1); the owner field still cannot move (S2).
 *  A   The app's routes (/api/playlists/...): the member adds, removes and
 *      reorders; only the owner renames, changes the cover, deletes, turns
 *      collaboration off, handles members and the invite link; the outsider
 *      and the admin get 404 for everything; names, never emails.
 *  L   The invite link: joins once, dies when replaced, turned off or when
 *      collaboration is off, and is replaced when the owner removes someone
 *      (or they could just rejoin); malformed codes are refused.
 *  D   Deleting a member's account keeps the songs they added.
 *
 *  Needs a throwaway PocketBase from this checkout (fresh data dir, this
 *  branch's pb_hooks) and the app started with POCKETBASE_URL pointing at it
 *  and POCKETBASE_ADMIN_EMAIL / POCKETBASE_ADMIN_PASSWORD set to the same
 *  sandbox superuser (tests/README.md, "What collab-rbac.test.mjs covers").
 *  Never the live one: it creates and deletes users and rows. */
const PB = process.env.PB_URL ?? 'http://127.0.0.1:8198';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:3170';
const SU_EMAIL = process.env.EMBER_PB_SUPERUSER_EMAIL;
const SU_PASSWORD = process.env.EMBER_PB_SUPERUSER_PASSWORD;
if (!SU_EMAIL || !SU_PASSWORD) {
  console.error('Set EMBER_PB_SUPERUSER_EMAIL and EMBER_PB_SUPERUSER_PASSWORD (the throwaway sandbox superuser).');
  process.exit(2);
}
const PW = 'CollabTest2026!';
const json = { 'content-type': 'application/json' };

const out = [];
const check = (name, pass, detail = '') => {
  out.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

async function call(base, method, path, auth, body) {
  const headers = { ...(body ? json : {}) };
  if (auth?.token && base === PB) headers.Authorization = auth.token;
  if (auth?.cookie && base === APP) headers.Cookie = auth.cookie;
  if (typeof auth === 'string') headers.Authorization = auth;
  const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  let data = null;
  try {
    data = await r.json();
  } catch {
    data = null;
  }
  return { status: r.status, data };
}
const pb = (method, path, who, body) => call(PB, method, path, who, body);
const app = (method, path, who, body) => call(APP, method, `/api${path}`, who, body);
const list = (col, who, params = {}) => pb('GET', `/api/collections/${col}/records?${new URLSearchParams(params)}`, who);

const su = (await pb('POST', '/api/admins/auth-with-password', null, { identity: SU_EMAIL, password: SU_PASSWORD })).data?.token;
if (!su) throw new Error(`superuser sign-in on ${PB} failed`);

const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
async function person(label, extra = {}) {
  const email = `${label}-${stamp}@ember.test`;
  const rec = await pb('POST', '/api/collections/users/records', su,
    { email, password: PW, passwordConfirm: PW, name: `${label[0].toUpperCase()}${label.slice(1)} ${stamp}`, verified: true, ...extra });
  if (rec.status !== 200) throw new Error(`could not create ${label}: ${JSON.stringify(rec.data)}`);
  const auth = await pb('POST', '/api/collections/users/auth-with-password', null, { identity: email, password: PW });
  const cookie = `pb_auth=${encodeURIComponent(JSON.stringify({ token: auth.data.token, record: auth.data.record }))}`;
  return { id: rec.data.id, email, name: rec.data.name, token: auth.data.token, cookie };
}
const owner = await person('owner');
const member = await person('member');
const outsider = await person('outsider');
const admin = await person('admin', { is_admin: true });

const song = (n) => ({
  id: `youtube:collab${stamp}${n}`, source: 'youtube', sourceId: `collab${stamp}${n}`, title: `Song ${n} ${stamp}`,
  artist: 'Band', artistId: null, album: null, albumId: null, durationSec: 200, artworkUrl: null, streamUrl: '',
});

// The owner's playlist, made collaborative, with the member on it and three
// songs, all through the app like the pages do it.
const made = await app('POST', '/playlists', owner, { name: `Road trip ${stamp}` });
const pid = made.data?.playlist?.id;
if (!pid) throw new Error(`could not create the playlist: ${JSON.stringify(made)}`);
for (const n of [1, 2, 3]) await app('POST', `/playlists/${pid}/tracks`, owner, { track: song(n) });
const on = await app('PATCH', `/playlists/${pid}/collab`, owner, { collaborative: true });
check('A the owner turns collaboration on', on.status === 200 && on.data.collaborative === true, `status ${on.status}`);
const addM = await app('POST', `/playlists/${pid}/members`, owner, { userId: member.id });
check('A the owner adds the member by id', addM.status === 200 && addM.data.members.some((m) => m.id === member.id), `status ${addM.status}`);
const priv = (await app('POST', '/playlists', owner, { name: `Diary ${stamp}` })).data.playlist.id;
await app('POST', `/playlists/${priv}/tracks`, owner, { track: song(9) });

const rowsOf = async (id) =>
  (await list('playlist_tracks', su, { filter: `playlist = "${id}"`, sort: 'position', expand: 'track', perPage: '200' })).data.items;
const orderOf = async (id) => (await rowsOf(id)).map((r) => r.expand.track.external_id);

// ── P: PocketBase directly ──────────────────────────────────────────────────
let r;
for (const [who, label] of [[member, 'member'], [outsider, 'outsider'], [admin, 'admin']]) {
  r = await pb('GET', `/api/collections/playlists/records/${pid}`, who);
  check(`P the ${label} cannot view the shared playlist through /pb`, r.status === 404, `status ${r.status}`);
  r = await list('playlists', who, { filter: `id = "${pid}"` });
  check(`P nor list it`, (r.data?.items ?? []).length === 0, `${(r.data?.items ?? []).length} row(s)`);
  r = await list('playlist_tracks', who, { filter: `playlist = "${pid}"` });
  check(`P nor list its songs`, (r.data?.items ?? []).length === 0, `${(r.data?.items ?? []).length} row(s)`);
}
const ownerRow = (await rowsOf(pid))[0];
const extraTrack = (await pb('POST', '/api/collections/tracks/records', su,
  { external_id: `youtube:pbx${stamp}`, source: 'youtube', source_id: `pbx${stamp}`, title: 'Planted' })).data.id;
r = await pb('POST', '/api/collections/playlist_tracks/records', member, { playlist: pid, track: extraTrack, position: 9, added_by: member.id });
check('P a member cannot add a song through /pb', r.status >= 400, `status ${r.status}`);
r = await pb('PATCH', `/api/collections/playlist_tracks/records/${ownerRow.id}`, member, { position: 99 });
check('P nor reorder through /pb', r.status === 404, `status ${r.status}`);
r = await pb('DELETE', `/api/collections/playlist_tracks/records/${ownerRow.id}`, member);
check('P nor remove through /pb', r.status === 404, `status ${r.status}`);
r = await pb('PATCH', `/api/collections/playlists/records/${pid}`, member, { name: 'Hijacked' });
check('P nor rename through /pb', r.status === 404, `status ${r.status}`);

for (const [who, label] of [[member, 'member'], [owner, 'owner'], [outsider, 'outsider']]) {
  r = await list('playlist_members', who, {});
  check(`P playlist_members is closed to the ${label}`, r.status === 403 || (r.data?.items ?? []).length === 0, `status ${r.status}`);
}
r = await pb('POST', '/api/collections/playlist_members/records', outsider, { playlist: pid, user: outsider.id });
check('P an outsider cannot put themselves on a playlist through /pb', r.status === 403, `status ${r.status}`);
r = await pb('POST', '/api/collections/playlist_members/records', owner, { playlist: pid, user: outsider.id });
check('P nor can the owner, bypassing the app', r.status === 403, `status ${r.status}`);

const ownMine = (await pb('POST', '/api/collections/playlists/records', outsider, { user: outsider.id, name: 'Mine' })).data.id;
r = await pb('POST', '/api/collections/playlists/records', outsider, { user: outsider.id, name: 'Sneaky', collaborative: true });
check('P a playlist cannot be created collaborative through /pb', r.status === 403, `status ${r.status}`);
r = await pb('PATCH', `/api/collections/playlists/records/${ownMine}`, outsider, { collaborative: true });
check('P nor made collaborative', r.status === 403, `status ${r.status}`);
const liveCode = (await app('POST', `/playlists/${pid}/invite`, owner)).data.inviteCode;
r = await pb('PATCH', `/api/collections/playlists/records/${ownMine}`, outsider, { invite_code: liveCode });
check('P nor given someone else\'s invite code (a link hijack)', r.status === 403, `status ${r.status}`);
r = await pb('PATCH', `/api/collections/playlists/records/${ownMine}`, outsider, { name: 'Renamed' });
check('P renaming your own playlist through /pb still works', r.status === 200, `status ${r.status}`);
r = await pb('POST', '/api/collections/playlist_tracks/records', outsider, { playlist: ownMine, track: extraTrack, position: 1, added_by: member.id });
check('P a song cannot be marked as added by someone else', r.status === 403, `status ${r.status}`);
r = await pb('POST', '/api/collections/playlist_tracks/records', outsider, { playlist: ownMine, track: extraTrack, position: 1 });
check('P adding to your own playlist through /pb still works', r.status === 200, `status ${r.status}`);
const outRow = r.data?.id;
for (const body of [{ added_by: member.id }, { 'added_by+': member.id }]) {
  r = await pb('PATCH', `/api/collections/playlist_tracks/records/${outRow}`, outsider, body);
  const after = (await pb('GET', `/api/collections/playlist_tracks/records/${outRow}`, su)).data;
  check(`P added_by cannot be changed afterwards (${Object.keys(body)[0]})`, r.status >= 400 && after.added_by === '', `status ${r.status}`);
}
// The owner's own cover upload (multipart, through their session) still
// passes the new hooks.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const form = new FormData();
form.append('artwork', new Blob([png], { type: 'image/png' }), 'cover.png');
const cover = await fetch(`${APP}/api/playlists/${pid}/artwork`, { method: 'PATCH', headers: { Cookie: owner.cookie }, body: form });
check('A the owner still changes the cover', cover.status === 200, `status ${cover.status}`);
r = await pb('PATCH', `/api/collections/playlists/records/${pid}`, owner, { user: member.id });
check('P the owner field still cannot be handed on (S2)', r.status >= 400, `status ${r.status}`);

for (const [label, col, params] of [
  ['who is on a playlist, through its back-relation', 'playlists', { filter: `playlist_members_via_playlist.user ?= "${member.id}"` }],
  ['who added a song, through added_by', 'playlist_tracks', { filter: `added_by.name ~ "Member"` }],
  ['shared playlist names, through a member', 'tracks', { filter: `playlist_tracks_via_track.playlist.name ~ "Road"` }],
]) {
  r = await list(col, outsider, params);
  check(`P S1 a join into ${label} is refused`, r.status === 400, `status ${r.status}`);
}

// Realtime: a member subscribed to the songs hears nothing of the owner's edits.
async function listen(who, topic, ms, act) {
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
  const sub = await pb('POST', '/api/realtime', who, { clientId, subscriptions: [topic] });
  const seen = [];
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = new TextDecoder().decode(value);
        for (const m of text.matchAll(/^event:(.+)$/gm)) seen.push(m[1].trim());
      }
    } catch { /* aborted */ }
  })();
  await act();
  await new Promise((res2) => setTimeout(res2, ms));
  ctl.abort();
  await pump;
  return { status: sub.status, seen: seen.filter((e) => e !== 'PB_CONNECT') };
}
const heard = await listen(member, 'playlist_tracks', 1500, () => app('POST', `/playlists/${pid}/tracks`, owner, { track: song(4) }));
check('P a member\'s realtime subscription hears nothing of the playlist', heard.seen.length === 0, `sub ${heard.status}, ${heard.seen.length} event(s)`);
const ownerHears = await listen(owner, 'playlist_tracks', 1500, () => app('POST', `/playlists/${pid}/tracks`, member, { track: song(5) }));
check('P (the owner\'s own subscription does hear a member\'s add)', ownerHears.seen.length > 0, `${ownerHears.seen.length} event(s)`);

// ── A: the app's routes ────────────────────────────────────────────────────
r = await app('GET', `/playlists/${pid}`, member);
check('A the member reads the playlist', r.status === 200 && r.data.playlist.role === 'member', `status ${r.status}`);
check('A it says whose it is', r.data?.playlist?.owner_name === owner.name, r.data?.playlist?.owner_name);
check('A each song says who added it', r.data?.tracks?.every((t) => t.addedBy?.name) &&
  r.data.tracks.some((t) => t.addedBy.id === member.id), (r.data?.tracks ?? []).map((t) => t.addedBy?.name).join(', '));
const memberView = JSON.stringify(r.data);
check('A no email address and no invite code in what a member reads', !memberView.includes('@') && !memberView.includes(liveCode));
r = await app('GET', '/playlists', member);
check('A it is in the member\'s library, marked shared with the owner\'s name',
  r.data.playlists.some((p) => p.id === pid && p.role === 'member' && p.owner_name === owner.name));
check('A the private playlist is not', !r.data.playlists.some((p) => p.id === priv));

r = await app('POST', `/playlists/${pid}/tracks`, member, { track: song(6) });
check('A the member adds a song', r.status === 201, `status ${r.status}`);
const row6 = (await rowsOf(pid)).find((x) => x.expand.track.external_id === song(6).id);
check('A marked as added by the member', row6?.added_by === member.id, row6?.added_by);
r = await app('POST', `/playlists/${pid}/tracks/move`, member, { trackId: song(6).id, to: 0 });
check('A the member reorders', r.status === 200 && (await orderOf(pid))[0] === song(6).id, `status ${r.status}`);
const positions = (await rowsOf(pid)).map((x) => x.position);
check('A positions are 1..n again', positions.every((p, i) => p === i + 1), positions.join(','));
r = await app('DELETE', `/playlists/${pid}/tracks/${encodeURIComponent(song(1).id)}`, member);
check('A the member removes a song (the owner\'s)', r.status === 200 && !(await orderOf(pid)).includes(song(1).id), `status ${r.status}`);
r = await app('POST', `/playlists/${pid}/tracks/bulk`, member, { tracks: [song(7), song(2)] });
check('A the member copies songs in (duplicates skipped)', r.status === 201 && r.data.added === 1, `status ${r.status}`);

const before = await orderOf(pid);
const ownerOnly = [
  ['rename', 'PATCH', `/playlists/${pid}`, { name: 'Mine now' }],
  ['delete', 'DELETE', `/playlists/${pid}`],
  ['turn collaboration off', 'PATCH', `/playlists/${pid}/collab`, { collaborative: false }],
  ['make a new invite link', 'POST', `/playlists/${pid}/invite`],
  ['turn the link off', 'DELETE', `/playlists/${pid}/invite`],
  ['add someone', 'POST', `/playlists/${pid}/members`, { userId: outsider.id }],
  ['list everyone on the server', 'GET', `/playlists/${pid}/people`],
];
for (const [label, method, path, body] of ownerOnly) {
  r = await app(method, path, member, body);
  check(`A the member cannot ${label}`, r.status === 403, `status ${r.status}`);
}
const artwork = await fetch(`${APP}/api/playlists/${pid}/artwork`, { method: 'PATCH', headers: { Cookie: member.cookie }, body: new FormData() });
check('A the member cannot change the cover', artwork.status === 403, `status ${artwork.status}`);
r = await app('GET', `/playlists/${pid}/collab`, member);
check('A the member sees who can edit, without the invite code', r.status === 200 && !('inviteCode' in r.data), `status ${r.status}`);
const pl = (await pb('GET', `/api/collections/playlists/records/${pid}`, su)).data;
check('A after all that the playlist is unchanged', pl.name === `Road trip ${stamp}` && pl.collaborative === true && pl.invite_code === liveCode);

for (const [who, label] of [[outsider, 'outsider'], [admin, 'admin']]) {
  const attempts = [
    ['GET', `/playlists/${pid}`], ['PATCH', `/playlists/${pid}`, { name: 'x' }], ['DELETE', `/playlists/${pid}`],
    ['POST', `/playlists/${pid}/tracks`, { track: song(8) }], ['DELETE', `/playlists/${pid}/tracks/${encodeURIComponent(song(2).id)}`],
    ['POST', `/playlists/${pid}/tracks/move`, { trackId: song(2).id, to: 0 }], ['POST', `/playlists/${pid}/tracks/bulk`, { tracks: [song(8)] }],
    ['POST', `/playlists/${pid}/tracks/${encodeURIComponent(song(2).id)}/replace`, { track: song(8) }],
    ['GET', `/playlists/${pid}/collab`], ['PATCH', `/playlists/${pid}/collab`, { collaborative: false }],
    ['POST', `/playlists/${pid}/invite`], ['DELETE', `/playlists/${pid}/invite`],
    ['POST', `/playlists/${pid}/members`, { userId: who.id }], ['DELETE', `/playlists/${pid}/members/${member.id}`],
    ['GET', `/playlists/${pid}/people`],
  ];
  const statuses = [];
  for (const [method, path, body] of attempts) statuses.push((await app(method, path, who, body)).status);
  check(`A the ${label} gets 404 from every playlist route`, statuses.every((s) => s === 404), statuses.join(','));
  r = await app('GET', '/playlists', who);
  check(`A the ${label}'s library does not list it`, !r.data.playlists.some((p) => p.id === pid));
}
check('A and nothing they tried changed the songs', JSON.stringify(await orderOf(pid)) === JSON.stringify(before));
r = await app('GET', `/playlists/${pid}`, null);
check('A signed out: 401', r.status === 401, `status ${r.status}`);

r = await app('GET', `/playlists/${pid}/people`, owner);
check('A the owner\'s picker lists people by name, no emails for a non-admin owner',
  r.status === 200 && r.data.people.some((p) => p.id === outsider.id) && !JSON.stringify(r.data).includes('@'), `status ${r.status}`);
const adminPl = (await app('POST', '/playlists', admin, { name: 'Admin mix' })).data.playlist.id;
await app('PATCH', `/playlists/${adminPl}/collab`, admin, { collaborative: true });
r = await app('GET', `/playlists/${adminPl}/people`, admin);
check('A an admin owner sees emails in the picker', r.data?.people?.find((p) => p.id === member.id)?.email === member.email);

// ── L: the invite link ──────────────────────────────────────────────────────
for (const code of ['', 'short', `${'a'.repeat(31)}"`, null]) {
  r = await app('POST', '/playlists/join', outsider, { code });
  check(`L a malformed code is refused (${JSON.stringify(code)})`, r.status === 404, `status ${r.status}`);
}
r = await app('POST', '/playlists/join', outsider, { code: liveCode });
check('L the outsider joins with the link', r.status === 200 && r.data.playlistId === pid && r.data.joined === true, JSON.stringify(r.data));
r = await app('POST', '/playlists/join', outsider, { code: liveCode });
check('L again is harmless', r.status === 200 && r.data.joined === false);
r = await app('GET', `/playlists/${pid}`, outsider);
check('L and can now open it', r.status === 200 && r.data.playlist.role === 'member', `status ${r.status}`);
// Removing someone who came in through the link replaces the link, or
// they could walk straight back in.
r = await app('DELETE', `/playlists/${pid}/members/${outsider.id}`, owner);
check('L the owner removes them; the answer carries a new link', r.status === 200 && /^[A-Za-z0-9_-]{32}$/.test(r.data.inviteCode ?? ''), `status ${r.status}`);
r = await app('POST', '/playlists/join', outsider, { code: liveCode });
check('L the removed person cannot rejoin with the old link', r.status === 404, `status ${r.status}`);
r = await app('POST', '/playlists/join', outsider, { code: (await app('GET', `/playlists/${pid}/collab`, owner)).data.inviteCode });
check('L (the new link, handed out again, does let them in)', r.status === 200 && r.data.joined === true, `status ${r.status}`);
const fresh = (await app('POST', `/playlists/${pid}/invite`, owner)).data.inviteCode;
r = await app('POST', '/playlists/join', admin, { code: liveCode });
check('L a replaced link stops working', r.status === 404, `status ${r.status}`);
await app('DELETE', `/playlists/${pid}/invite`, owner);
r = await app('POST', '/playlists/join', admin, { code: fresh });
check('L a link turned off stops working', r.status === 404, `status ${r.status}`);

r = await app('DELETE', `/playlists/${pid}/members/${member.id}`, outsider);
check('A a member cannot remove another member', r.status === 403, `status ${r.status}`);
r = await app('DELETE', `/playlists/${pid}/members/${outsider.id}`, outsider);
check('A a member can leave', r.status === 200 && (await app('GET', `/playlists/${pid}`, outsider)).status === 404, `status ${r.status}`);

const relink = (await app('POST', `/playlists/${pid}/invite`, owner)).data.inviteCode;
await app('PATCH', `/playlists/${pid}/collab`, owner, { collaborative: false });
r = await app('GET', `/playlists/${pid}`, member);
check('A with collaboration off the member gets 404', r.status === 404, `status ${r.status}`);
r = await app('POST', `/playlists/${pid}/tracks`, member, { track: song(10) });
check('A and cannot add', r.status === 404, `status ${r.status}`);
r = await app('POST', '/playlists/join', admin, { code: relink });
check('L and the link died with it', r.status === 404, `status ${r.status}`);
const quitter = await person('quitter');
await app('POST', `/playlists/${pid}/members`, owner, { userId: quitter.id }).catch(() => null);
await pb('POST', '/api/collections/playlist_members/records', su, { playlist: pid, user: quitter.id });
r = await app('DELETE', `/playlists/${pid}/members/${quitter.id}`, quitter);
check('A a member can leave while collaboration is off', r.status === 200, `status ${r.status}`);
await app('PATCH', `/playlists/${pid}/collab`, owner, { collaborative: true });
r = await app('GET', `/playlists/${pid}`, member);
check('A turning it back on lets the same member in again', r.status === 200, `status ${r.status}`);
r = await app('GET', `/playlists/${pid}`, quitter);
check('A but not the one who left', r.status === 404, `status ${r.status}`);
await pb('DELETE', `/api/collections/users/records/${quitter.id}`, su);

// ── D: deleting a member's account ─────────────────────────────────────────
const leaver = await person('leaver');
await app('POST', `/playlists/${pid}/members`, owner, { userId: leaver.id });
await app('POST', `/playlists/${pid}/tracks`, leaver, { track: song(11) });
r = await pb('DELETE', `/api/collections/users/records/${leaver.id}`, su);
check('D a member who added a song can still be deleted', r.status === 204, `status ${r.status}`);
r = await app('GET', `/playlists/${pid}`, owner);
const kept = r.data.tracks.find((t) => t.id === song(11).id);
check('D the song they added stays, added by nobody now', !!kept && kept.addedBy === null, JSON.stringify(kept?.addedBy));

// ── the owner still owns everything ────────────────────────────────────────
r = await app('PATCH', `/playlists/${pid}`, owner, { name: `Road trip ${stamp} (renamed)` });
check('A the owner renames', r.status === 200, `status ${r.status}`);
r = await app('DELETE', `/playlists/${pid}`, owner);
check('A the owner deletes it', r.status === 200, `status ${r.status}`);
r = await list('playlist_members', su, { filter: `playlist = "${pid}"` });
check('A its member list goes with it', r.data.items.length === 0, `${r.data.items.length} row(s)`);
r = await app('GET', '/playlists', member);
check('A and it leaves the member\'s library', !r.data.playlists.some((p) => p.id === pid));

// Tidy up the rest of this run's people.
for (const who of [owner, member, outsider, admin]) await pb('DELETE', `/api/collections/users/records/${who.id}`, su);

const failed = out.filter((c) => !c.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
process.exit(failed.length ? 1 : 0);
