/** Unavailable songs — Task 1 (server foundation).
 *
 *      node tests/unavailable.test.mjs
 *
 *  Part A: detection of definitive yt-dlp failures, the flag round-tripping
 *  through playlists and likes, the stream route's 410, and the flag
 *  clearing itself once a track plays again.
 *
 *  Sandbox (this worktree's own — never :8091/:3010, another worker owns
 *  those):
 *
 *    PB_DIR=/private/tmp/claude-501/-Users-aronmatoic-Documents-Main-Projects/b6633bdb-0822-453b-a2b4-a986b08153a8/scratchpad/unavail-pb
 *    "/Users/aronmatoic/Documents/Main Projects/spotify-clone/pocketbase/pocketbase" serve \
 *      --http=127.0.0.1:8092 --dir="$PB_DIR/pb_data" --hooksDir="$PWD/pocketbase/pb_hooks" &
 *
 *    SB="$PB_DIR" && mkdir -p "$SB" && : > "$SB/unavailable.txt" && : > "$SB/transient.txt"
 *    cd apps/web && POCKETBASE_URL=http://127.0.0.1:8092 STREAM_MODE= PYTHON_BIN=/bin/bash \
 *    PLAYER_SCRIPT="$PWD/../../tests/fake-player.sh" MUSIC_DIR="$SB/music" FAKE_PLAYER_LOG="$SB/calls.log" \
 *    FAKE_UNAVAILABLE_FILE="$SB/unavailable.txt" FAKE_TRANSIENT_FILE="$SB/transient.txt" STREAM_CACHE_WARM=0 \
 *    POCKETBASE_ADMIN_EMAIL=admin@ember.com POCKETBASE_ADMIN_PASSWORD=egKa5WNMx3QpuG7 npx next start -p 3011 &
 *
 *  Then: PB_URL=http://127.0.0.1:8092 APP_URL=http://127.0.0.1:3011 SB="$PB_DIR" node tests/unavailable.test.mjs
 */
import fs from 'node:fs';

const PB = process.env.PB_URL ?? 'http://127.0.0.1:8092';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:3011';
const SB = process.env.SB ?? '/tmp/ember-unavailable-test';
const PW = 'BugTest2026!';

const DEAD = 'ddddddddddd';
const LIVE = 'aaaaaaaaaaa';
const FLAKY = 'ccccccccccc';

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
  const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e5)}@ember.test`;
  const rec = await fetch(`${PB}/api/collections/users/records`, { method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: tok },
    body: JSON.stringify({ email, password: PW, passwordConfirm: PW, name: label, verified: true }) })
    .then((r) => r.json());
  const auth = await fetch(`${PB}/api/collections/users/auth-with-password`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PW }) })
    .then((r) => r.json());
  return { id: rec.id, cookie: `pb_auth=${encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }))}` };
}

function track(videoId, title) {
  return {
    id: `youtube:${videoId}`,
    source: 'youtube',
    sourceId: videoId,
    title,
    artist: 'Fake Artist',
    artistId: null,
    album: null,
    albumId: null,
    durationSec: 200,
    artworkUrl: null,
    streamUrl: `/api/youtube/stream/${videoId}`,
  };
}

const me = await user('unavail');

function call(path, opts = {}) {
  return fetch(APP + path, {
    ...opts,
    redirect: 'manual',
    headers: {
      ...(opts.headers || {}),
      cookie: me.cookie,
      ...(opts.body && typeof opts.body === 'string' ? { 'content-type': 'application/json' } : {}),
    },
  });
}

const writeList = (name, ids) => fs.writeFileSync(`${SB}/${name}`, ids.join('\n') + (ids.length ? '\n' : ''));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** markTrackUnavailable / clearTrackUnavailable are fire-and-forget (`void`)
 *  in the route so the stream response doesn't wait on a PocketBase write —
 *  poll briefly rather than racing it. */
async function pollTrack(getPlaylist, videoId, predicate, tries = 20) {
  let track;
  for (let i = 0; i < tries; i++) {
    const pl = await getPlaylist();
    track = pl.tracks?.find((t) => t.id === `youtube:${videoId}`);
    if (predicate(track)) return track;
    await sleep(100);
  }
  return track;
}

// ── A0: setup — a playlist with DEAD, LIVE, FLAKY; DEAD marked unavailable,
//    FLAKY marked transient (a 403 that must never be mistaken for dead) ──
const plRes = await call('/api/playlists', { method: 'POST', body: JSON.stringify({ name: 'Unavailable test' }) });
const { playlist } = await plRes.json().catch(() => ({}));
check('A0 playlist created', plRes.status === 201 && !!playlist?.id, `status ${plRes.status}`);
const playlistId = playlist?.id;

for (const [id, title] of [[DEAD, 'Dead Song'], [LIVE, 'Live Song'], [FLAKY, 'Flaky Song']]) {
  const r = await call(`/api/playlists/${playlistId}/tracks`, {
    method: 'POST',
    body: JSON.stringify({ track: track(id, title) }),
  });
  check(`A0 added ${title} to playlist`, r.status === 201, `status ${r.status}`);
}

writeList('unavailable.txt', [DEAD]);
writeList('transient.txt', [FLAKY]);

// ── A1: streaming a definitively-removed video answers 410 with a clean
//    reason, no Python traceback ──
const s1 = await call(`/api/youtube/stream/${DEAD}`);
const s1body = await s1.json().catch(() => ({}));
check('A1 stream DEAD is 410', s1.status === 410, `status ${s1.status}`);
check('A1 unavailable === true', s1body?.unavailable === true, JSON.stringify(s1body));
check('A1 reason === removed', s1body?.reason === 'removed', `reason ${s1body?.reason}`);
check('A1 error has no Traceback', typeof s1body?.error === 'string' && !s1body.error.includes('Traceback'), s1body?.error);

// ── A2: the flag shows up on the playlist row, and only on the dead track ──
const pl2 = await call(`/api/playlists/${playlistId}`).then((r) => r.json());
const dead2 = pl2.tracks?.find((t) => t.id === `youtube:${DEAD}`);
const live2 = pl2.tracks?.find((t) => t.id === `youtube:${LIVE}`);
check('A2 DEAD carries unavailableAt', !!dead2?.unavailableAt, JSON.stringify(dead2));
check('A2 DEAD carries reason removed', dead2?.unavailableReason === 'removed', dead2?.unavailableReason);
check('A2 LIVE has no unavailableAt', !live2?.unavailableAt, JSON.stringify(live2));

// ── A3: one truth — liking the dead track carries the same flag through
//    /api/likes ──
const likeRes = await call('/api/likes', { method: 'POST', body: JSON.stringify({ track: track(DEAD, 'Dead Song') }) });
check('A3 like DEAD ok', likeRes.status === 201, `status ${likeRes.status}`);
const likes = await call('/api/likes').then((r) => r.json());
const likedDead = likes.tracks?.find((t) => t.id === `youtube:${DEAD}`);
check('A3 liked DEAD carries the flag', !!likedDead?.unavailableAt && likedDead.unavailableReason === 'removed', JSON.stringify(likedDead));

// ── A4: a transient failure (bot check / 403) must NOT be mistaken for
//    dead — no 410, and the playlist doesn't flag it ──
const s4 = await call(`/api/youtube/stream/${FLAKY}`);
check('A4 stream FLAKY is >= 500', s4.status >= 500, `status ${s4.status}`);
check('A4 stream FLAKY is not 410', s4.status !== 410, `status ${s4.status}`);
const pl4 = await call(`/api/playlists/${playlistId}`).then((r) => r.json());
const flaky4 = pl4.tracks?.find((t) => t.id === `youtube:${FLAKY}`);
check('A4 FLAKY has no unavailableAt', !flaky4?.unavailableAt, JSON.stringify(flaky4));

// ── A5: the flag clears once the track plays again, and re-flags on the
//    next definitive failure ──
writeList('unavailable.txt', []);
const s5 = await call(`/api/youtube/stream/${DEAD}`);
check('A5 stream DEAD is 200 once restored', s5.status === 200, `status ${s5.status}`);
await s5.arrayBuffer().catch(() => {});
const getPl = () => call(`/api/playlists/${playlistId}`).then((r) => r.json());
const dead5 = await pollTrack(getPl, DEAD, (t) => !t?.unavailableAt);
check('A5 DEAD flag cleared', !dead5?.unavailableAt, JSON.stringify(dead5));

writeList('unavailable.txt', [DEAD]);
try { fs.unlinkSync(`${SB}/music/${DEAD}.m4a`); } catch {}
const s5b = await call(`/api/youtube/stream/${DEAD}`);
check('A5 DEAD re-flags as 410', s5b.status === 410, `status ${s5b.status}`);

const failed = out.filter((o) => !o.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
if (failed.length) process.exit(1);
