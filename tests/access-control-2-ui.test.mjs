/** Access control over HTTP, round 2: carlists, deleting a member, tabs and
 *  the invite check (bughunt X1, X2, X4, X7, X8, X10).
 *
 *      EMBER_PB_SUPERUSER_EMAIL=... EMBER_PB_SUPERUSER_PASSWORD=... \
 *      EMBER_ADMIN_EMAIL=... EMBER_ADMIN_PASSWORD=... MUSIC_DIR=<app's MUSIC_DIR> \
 *      PB_URL=http://127.0.0.1:8084 APP_URL=http://127.0.0.1:3055 \
 *      node tests/access-control-2-ui.test.mjs
 *
 *  Each probe PASSES when the attempt is refused and nothing changed. The F
 *  checks are the everyday flows the fixes must not break.
 *
 *  Needs a throwaway PocketBase started with this worktree's hooks and
 *  migrations (the EMBER_* values above make its superuser and owner
 *  account, bughunt W14) and the app built against it, sharing MUSIC_DIR so
 *  the tab file checks can see the disk. Members are created fresh per run.
 *  The X1 probe spends this IP's check-email allowance: a second run within
 *  ten minutes needs a restarted app. */
import fs from 'node:fs';
import path from 'node:path';

const PB = process.env.PB_URL ?? 'http://127.0.0.1:8084';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:3055';
const MUSIC_DIR = process.env.MUSIC_DIR ?? '';
const PW = 'BugTest2026!';

const SU_EMAIL = process.env.EMBER_PB_SUPERUSER_EMAIL;
const SU_PASSWORD = process.env.EMBER_PB_SUPERUSER_PASSWORD;
const ADMIN_EMAIL = process.env.EMBER_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.EMBER_ADMIN_PASSWORD;
if (!SU_EMAIL || !SU_PASSWORD || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Set EMBER_PB_SUPERUSER_EMAIL/_PASSWORD and EMBER_ADMIN_EMAIL/_PASSWORD (the throwaway sandbox accounts).');
  process.exit(2);
}

const out = [];
const check = (name, pass, detail = '') => {
  out.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

async function superToken() {
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const r = await fetch(PB + p, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: SU_EMAIL, password: SU_PASSWORD }),
    });
    if (r.ok) return (await r.json()).token;
  }
  throw new Error('superuser sign-in failed: check EMBER_PB_SUPERUSER_*');
}
const tok = await superToken();
const asSuper = (p, init = {}) =>
  fetch(PB + p, { ...init, headers: { 'content-type': 'application/json', Authorization: tok, ...(init.headers || {}) } });
const superGet = (p) => asSuper(p).then((r) => (r.ok ? r.json() : null));

const cookieOf = (token, record) => `pb_auth=${encodeURIComponent(JSON.stringify({ token, record }))}`;

async function signIn(email, password) {
  const auth = await fetch(`${PB}/api/collections/users/auth-with-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: email, password }),
  }).then((r) => r.json());
  if (!auth.token) throw new Error(`sign-in failed for ${email}`);
  return { id: auth.record.id, email, token: auth.token, record: auth.record, cookie: cookieOf(auth.token, auth.record) };
}

async function member(name) {
  const email = `${name.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 1e5)}@ember.test`;
  await asSuper('/api/collections/users/records', {
    method: 'POST',
    body: JSON.stringify({ email, password: PW, passwordConfirm: PW, name, verified: true }),
  });
  return signIn(email, PW);
}

const as = (u, p, init = {}) =>
  fetch(APP + p, {
    ...init,
    redirect: 'manual',
    headers: {
      ...(init.headers || {}),
      cookie: u.cookie,
      ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}),
    },
  });
const asJson = (u, p, init) => as(u, p, init).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
// Straight at PocketBase through the app's /pb proxy, the way a browser
// holding its own session token could.
const pbAs = (u, p, init = {}) =>
  fetch(`${APP}/pb${p}`, {
    ...init,
    headers: { 'content-type': 'application/json', Authorization: u.token, ...(init.headers || {}) },
  });
const pbJson = (u, p, init) => pbAs(u, p, init).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const q = (filter) => encodeURIComponent(filter);

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

/** A tab row owned by `u`, with a real file behind it in MUSIC_DIR/tabs. */
async function makeTab(u, title) {
  const file = `x10-${Date.now()}-${Math.floor(Math.random() * 1e5)}.gp5`;
  if (MUSIC_DIR) {
    fs.mkdirSync(path.join(MUSIC_DIR, 'tabs'), { recursive: true });
    fs.writeFileSync(path.join(MUSIC_DIR, 'tabs', file), 'not really a tab');
  }
  const row = await asSuper('/api/collections/tabs/records', {
    method: 'POST',
    body: JSON.stringify({ user: u.id, title, artist: 'A', file, kind: 'file', format: 'gp5', shared: true, song_key: `${title.toLowerCase()}::a` }),
  }).then((r) => r.json());
  return { id: row.id, file };
}
const tabFileExists = (file) => (MUSIC_DIR ? fs.existsSync(path.join(MUSIC_DIR, 'tabs', file)) : true);

const admin = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
const hana = await member('Hana'); // hosts the carlist
const gus = await member('Gus'); // joins it with the code
const stan = await member('Stan'); // signed in, never given the code

// ── F: a carlist from start to end, as the app does it ──────────────────
const started = await asJson(hana, '/api/sessions', { method: 'POST', body: JSON.stringify({ name: 'Road trip' }) });
const sid = started.json?.session?.id;
const code = started.json?.session?.code;
check('F1 the host starts a carlist', started.status === 201 && !!sid && !!code, `status ${started.status}`);

const joined = await asJson(gus, '/api/sessions/join', { method: 'POST', body: JSON.stringify({ code }) });
check('F2 a guest joins with the code', joined.status === 200 && joined.json?.session?.id === sid, `status ${joined.status}`);

const song = mkTrack('Carlist Song');
const hostTrack = mkTrack('Host Song');
const addedSong = await as(gus, `/api/sessions/${sid}/tracks`, { method: 'POST', body: JSON.stringify({ track: song }) });
check('F3 the guest adds a song', addedSong.status === 201, `status ${addedSong.status}`);
const hostSong = await as(hana, `/api/sessions/${sid}/tracks`, { method: 'POST', body: JSON.stringify({ track: hostTrack }) });
check('F3b the host adds a song', hostSong.status === 201, `status ${hostSong.status}`);

const state = await asJson(gus, `/api/sessions/${sid}`);
const queued = (state.json?.queue ?? []).find((i) => i.track?.id === song.id);
const hostQueued = (state.json?.queue ?? []).find((i) => i.track?.id === hostTrack.id);
check('F4 the guest sees the queue', state.status === 200 && !!queued, `status ${state.status}`);

// X8: names, not "someone" / "host".
check('X8a the queue shows who else added a song', hostQueued?.addedByName === 'Hana' && queued?.addedByName === 'Gus', `host's song by ${JSON.stringify(hostQueued?.addedByName)}`);
check('X8b the carlist shows the host by name', state.json?.session?.hostName === 'Hana', `hostName ${JSON.stringify(state.json?.session?.hostName)}`);
check('X8c no email address reaches other members', !JSON.stringify(state.json ?? {}).includes('@ember.test'));

const skipped = await as(gus, `/api/sessions/${sid}/skip`, { method: 'POST' });
check('F5 the guest skips', skipped.status === 201, `status ${skipped.status}`);
const consumed = await asJson(hana, `/api/sessions/${sid}/commands/consume`, { method: 'POST' });
check('F5b the host receives the skip', consumed.status === 200 && (consumed.json?.commands ?? []).some((c) => c.type === 'skip'), `status ${consumed.status}`);

const now = await as(hana, `/api/sessions/${sid}/now`, { method: 'POST', body: JSON.stringify({ index: 1 }) });
check('F6 the host moves to the next song', now.ok, `status ${now.status}`);
const saved = await as(gus, `/api/sessions/${sid}/save`, { method: 'POST', body: JSON.stringify({ name: 'Kept' }) });
check('F7 the guest keeps the mix as a playlist', saved.status === 201, `status ${saved.status}`);

// ── X2: a signed-in member who never got the code ────────────────────────
const listed = await pbJson(stan, `/api/collections/sessions/records?perPage=200`);
const leaked = JSON.stringify(listed.json ?? {}).includes(code);
check('X2a a non-member cannot list join codes', !leaked, `status ${listed.status}, code ${leaked ? 'visible' : 'hidden'}`);
const viewed = await pbJson(stan, `/api/collections/sessions/records/${sid}`);
check('X2b a non-member cannot open the carlist record', viewed.status === 404 || viewed.status === 403, `status ${viewed.status}`);

const selfAdd = await pbAs(stan, '/api/collections/session_members/records', { method: 'POST', body: JSON.stringify({ session: sid, user: stan.id }) });
const stanSkip = await as(stan, `/api/sessions/${sid}/skip`, { method: 'POST' });
check('X2c a non-member cannot add themselves to the roster', !selfAdd.ok && stanSkip.status === 403, `pb ${selfAdd.status}, then skip ${stanSkip.status}`);

const cmd = await pbAs(stan, '/api/collections/session_commands/records', { method: 'POST', body: JSON.stringify({ session: sid, type: 'skip', issued_by: stan.id }) });
const pending = await asJson(hana, `/api/sessions/${sid}/commands/consume`, { method: 'POST' });
check('X2d a non-member cannot skip the host’s song', !cmd.ok && (pending.json?.commands ?? []).length === 0, `status ${cmd.status}`);

const catalogRow = (await superGet(`/api/collections/tracks/records?filter=${q(`external_id="${song.id}"`)}`))?.items?.[0];
const planted = await pbAs(stan, '/api/collections/session_tracks/records', {
  method: 'POST',
  body: JSON.stringify({ session: sid, track: catalogRow?.id, position: 99, added_by: stan.id, played: false }),
});
check('X2e a non-member cannot queue songs', !planted.ok, `status ${planted.status}`);

const gusRow = (await superGet(`/api/collections/session_tracks/records?filter=${q(`session="${sid}" && added_by="${gus.id}"`)}`))?.items?.[0];
const gusPatch = gusRow
  ? await pbAs(gus, `/api/collections/session_tracks/records/${gusRow.id}`, { method: 'DELETE' })
  : { ok: true, status: 0 };
const gusPlant = await pbAs(gus, '/api/collections/session_tracks/records', {
  method: 'POST',
  body: JSON.stringify({ session: sid, track: catalogRow?.id, position: 98, added_by: gus.id, played: false }),
});
check('X2f even a member writes the queue only through the app', !!gusRow && !gusPatch.ok && !gusPlant.ok, `delete ${gusPatch.status}, create ${gusPlant.status}`);

const roster = await pbJson(stan, `/api/collections/session_members/records?filter=${q(`session="${sid}"`)}`);
const queueRows = await pbJson(stan, `/api/collections/session_tracks/records?filter=${q(`session="${sid}"`)}`);
check(
  'X2g a non-member cannot read who is in it or what is queued',
  (roster.json?.items ?? []).length === 0 && (queueRows.json?.items ?? []).length === 0,
  `roster ${(roster.json?.items ?? []).length}, queue ${(queueRows.json?.items ?? []).length}`,
);
const mine = await pbJson(gus, `/api/collections/sessions/records/${sid}`);
const mineQueue = await pbJson(gus, `/api/collections/session_tracks/records?filter=${q(`session="${sid}"`)}`);
check('F4b a member can still read their own carlist in PocketBase', mine.status === 200 && (mineQueue.json?.items ?? []).length >= 2, `status ${mine.status}, queue ${(mineQueue.json?.items ?? []).length}`);
const guessed = await as(stan, `/api/sessions/${sid}`);
check('X2h the app still refuses a non-member with the id', guessed.status === 403, `status ${guessed.status}`);

// ── X4: deleting a member who took part ──────────────────────────────────
const leo = await member('Leo');
const leoUp = await upload(leo, `Leo Upload ${Date.now()}`);
const leoUpId = leoUp.json?.track?.sourceId;
await as(leo, '/api/sessions/join', { method: 'POST', body: JSON.stringify({ code }) });
const leoSong = mkTrack('Leo Queued');
const leoAdd = await as(leo, `/api/sessions/${sid}/tracks`, { method: 'POST', body: JSON.stringify({ track: leoSong }) });
const leoSkip = await as(leo, `/api/sessions/${sid}/skip`, { method: 'POST' });
check('F8 a second guest uploads, queues and skips', leoUp.status === 201 && leoAdd.status === 201 && leoSkip.status === 201, `upload ${leoUp.status}, add ${leoAdd.status}, skip ${leoSkip.status}`);

const removed = await asJson(admin, `/api/admin/users/${leo.id}`, { method: 'DELETE' });
const leoGone = !(await asSuper(`/api/collections/users/records/${leo.id}`)).ok;
check('X4a an admin can delete a member who added a carlist song and uploaded one', removed.status === 200 && leoGone, `status ${removed.status}${removed.status === 200 ? '' : ` ${JSON.stringify(removed.json).slice(0, 120)}`}`);
const upKept = leoUpId ? await superGet(`/api/collections/uploads/records/${leoUpId}`) : null;
check('X4b their upload stays for everyone', !!upKept && (leoGone ? !upKept.uploader : true), `uploader ${JSON.stringify(upKept?.uploader)}`);
const after4 = await asJson(gus, `/api/sessions/${sid}`);
check('X4c the carlist keeps working, their song still queued', after4.status === 200 && (after4.json?.queue ?? []).some((i) => i.track?.id === leoSong.id), `status ${after4.status}`);
const streamed = leoUpId ? await as(gus, `/api/uploads/${leoUpId}/stream`) : { status: 0 };
check('X4d their upload still plays', streamed.status === 200 || streamed.status === 206, `status ${streamed.status}`);

const plain = await member('Plain');
const plainDel = await as(admin, `/api/admin/users/${plain.id}`, { method: 'DELETE' });
check('F9 an admin deletes a member with no history', plainDel.status === 200, `status ${plainDel.status}`);

// ── X10: tabs outlive their uploader; files go only with their row ──────
const tia = await member('Tia');
const shared = await makeTab(tia, `X10 Shared ${Date.now()}`);
const own = await makeTab(tia, `X10 Own ${Date.now()}`);
const pbDel = await pbAs(tia, `/api/collections/tabs/records/${own.id}`, { method: 'DELETE' });
const ownStill = await superGet(`/api/collections/tabs/records/${own.id}`);
check('X10a a tab row cannot be deleted around the app (its file would stay)', !pbDel.ok && !!ownStill && tabFileExists(own.file), `status ${pbDel.status}`);
const appDel = await as(tia, `/api/tabs/files/${own.id}`, { method: 'DELETE' });
const ownGone = !(await asSuper(`/api/collections/tabs/records/${own.id}`)).ok;
check('F10 the uploader deletes their tab in the app, file and all', appDel.status === 200 && ownGone && !tabFileExists(own.file), `status ${appDel.status}`);

const tiaDel = await as(admin, `/api/admin/users/${tia.id}`, { method: 'DELETE' });
const sharedKept = await superGet(`/api/collections/tabs/records/${shared.id}`);
check('X10b deleting a member keeps the tabs they shared', tiaDel.status === 200 && !!sharedKept && tabFileExists(shared.file), `delete ${tiaDel.status}, row ${sharedKept ? 'kept' : 'gone'}`);
const sharedSeen = await asJson(gus, `/api/tabs/files/${shared.id}/download`);
check('X10c others still open that tab', sharedSeen.status === 200, `status ${sharedSeen.status}`);

// ── F: ending the carlist ────────────────────────────────────────────────
const ended = await as(hana, `/api/sessions/${sid}/end`, { method: 'POST' });
const afterEnd = await asJson(gus, `/api/sessions/${sid}`);
check('F11 the host ends it and the guest sees it ended', ended.ok && afterEnd.json?.session?.active === false, `end ${ended.status}, poll ${afterEnd.status}`);

// ── X7: liking and unliking are safe to repeat ───────────────────────────
const heart = mkTrack('Heart Song');
const l1 = await as(gus, '/api/likes', { method: 'POST', body: JSON.stringify({ track: heart }) });
const l2 = await as(gus, '/api/likes', { method: 'POST', body: JSON.stringify({ track: heart }) });
const heartRow = (await superGet(`/api/collections/tracks/records?filter=${q(`external_id="${heart.id}"`)}`))?.items?.[0];
const likeRows = heartRow ? (await superGet(`/api/collections/likes/records?filter=${q(`user="${gus.id}" && track="${heartRow.id}"`)}`))?.items ?? [] : [];
check('X7a liking twice leaves one like', l1.status === 201 && l2.status === 201 && likeRows.length === 1, `statuses ${l1.status}/${l2.status}, rows ${likeRows.length}`);
const u1 = await as(gus, `/api/likes/${encodeURIComponent(heart.id)}`, { method: 'DELETE' });
const u2 = await as(gus, `/api/likes/${encodeURIComponent(heart.id)}`, { method: 'DELETE' });
const likes = await asJson(gus, '/api/likes');
check('X7b unliking twice is fine and leaves it unliked', u1.ok && u2.ok && !(likes.json?.tracks ?? []).some((t) => t.id === heart.id), `statuses ${u1.status}/${u2.status}`);

// ── X1: the invite check cannot be asked without limit ───────────────────
const inviteCheck = () => fetch(`${APP}/api/auth/check-email`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `probe-${Math.floor(Math.random() * 1e9)}@ember.test` }),
});
const first = await inviteCheck();
check('F12 the sign-in page can still check an email', first.status === 200, `status ${first.status}`);
const statuses = [];
for (let i = 0; i < 40; i++) statuses.push((await inviteCheck()).status);
const limited = statuses.filter((s) => s === 429).length;
check('X1 one caller cannot check emails without limit', limited > 0, `${statuses.filter((s) => s === 200).length} answered, ${limited} refused`);

const failed = out.filter((r) => !r.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
process.exit(failed.length ? 1 : 0);
