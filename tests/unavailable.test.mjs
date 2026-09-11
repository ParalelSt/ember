/** Unavailable songs, Task 1 (server foundation).
 *
 *      node tests/unavailable.test.mjs
 *
 *  Part A: detection of definitive yt-dlp failures, the flag round-tripping
 *  through playlists and likes, the stream route's 410, and the flag
 *  clearing itself once a track plays again.
 *
 *  Sandbox (this worktree's own, never :8091/:3010, another worker owns
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
import { register } from 'node:module';

const out = [];
const check = (name, pass, detail = '') => {
  out.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
};

// ── Unit: classifyYtdlpFailure, exercised directly from the real TS source
//    (not over HTTP) so a bad anchor in the "does not exist" rule fails this
//    file instead of only showing up as a flaky integration case. ──
{
  register('./ts-stub-loader.mjs', import.meta.url);
  const { classifyYtdlpFailure } = await import('../apps/web/lib/sources/youtube.ts');
  check(
    'classify: postprocessing "does not exist" is not unavailable',
    classifyYtdlpFailure('ERROR: Postprocessing: file /tmp/x.m4a does not exist') === null,
  );
  check(
    'classify: "Video does not exist" is still unavailable',
    classifyYtdlpFailure('ERROR: [youtube] abc: Video does not exist') === 'unavailable',
  );
}

const PB = process.env.PB_URL ?? 'http://127.0.0.1:8092';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:3011';
const SB = process.env.SB ?? '/tmp/ember-unavailable-test';
const PW = 'BugTest2026!';

const DEAD = 'ddddddddddd';
const LIVE = 'aaaaaaaaaaa';
const FLAKY = 'ccccccccccc';

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
 *  in the route so the stream response doesn't wait on a PocketBase write:
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

/** Ground truth check against PocketBase directly (not the app's 60s-cached
 *  listUnavailableIds()), so idempotency doesn't depend on app cache timing. */
async function waitClearedInPB(videoIds, tries = 30) {
  const wanted = new Set(videoIds.map((id) => `youtube:${id}`));
  for (let i = 0; i < tries; i++) {
    const rows = await fetch(`${PB}/api/collections/tracks/records?filter=${encodeURIComponent('unavailable_at != ""')}&perPage=200`,
      { headers: { Authorization: tok } }).then((r) => r.json());
    const stillFlagged = (rows.items ?? []).some((r) => wanted.has(r.external_id));
    if (!stillFlagged) return;
    await sleep(100);
  }
}

// ── Idempotency: a rerun against a reused sandbox must not start with any of
//    this test's ids already flagged from a previous pass. Stream each one
//    with the fake player set to succeed, so the server's own clearIfFlagged
//    path (not a hand-written PocketBase patch) clears the PB flag AND nulls
//    the app's in-memory unavailable-ids cache. A raw admin PATCH would clear
//    PocketBase but leave that cache stale for up to 60s, which would make
//    the very next run's B2 candidate-ordering check fail intermittently. ──
const IDEMPOTENCY_IDS = [DEAD, LIVE, FLAKY, 'bbbbbbbbbbb', 'eeeeeeeeeee', 'fffffffffff'];
writeList('unavailable.txt', []);
writeList('transient.txt', []);
for (const id of IDEMPOTENCY_IDS) {
  const r = await call(`/api/youtube/stream/${id}`).catch(() => null);
  await r?.arrayBuffer().catch(() => {});
}
await waitClearedInPB(IDEMPOTENCY_IDS);
// Streaming to clear the flag also downloads each id to MUSIC_DIR as a side
// effect of succeeding. Left in place, that cached file would poison A1/A4/B2
// below (a cache hit skips the fake player entirely, so DEAD/FLAKY/eee could
// never fail again). Delete it now that the flag is cleared.
for (const id of IDEMPOTENCY_IDS) {
  try { fs.unlinkSync(`${SB}/music/${id}.m4a`); } catch {}
}

// ── A0: setup, a playlist with DEAD, LIVE, FLAKY; DEAD marked unavailable,
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

// upsertTrack only backfills MISSING fields, so a title left over from an
// earlier run against this same sandbox (e.g. tests/unavailable-ui.test.mjs
// renames DEAD to "Replacement Song") would otherwise stick and silently
// break B2's songKey assertions. Force the titles this file assumes.
async function forceTitle(videoId, title) {
  const rows = await fetch(
    `${PB}/api/collections/tracks/records?filter=${encodeURIComponent(`external_id = "youtube:${videoId}"`)}`,
    { headers: { Authorization: tok } },
  ).then((r) => r.json());
  const row = rows.items?.[0];
  if (row && row.title !== title) {
    await fetch(`${PB}/api/collections/tracks/records/${row.id}`, {
      method: 'PATCH',
      headers: { Authorization: tok, 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    });
  }
}
for (const [id, title] of [[DEAD, 'Dead Song'], [LIVE, 'Live Song'], [FLAKY, 'Flaky Song']]) {
  await forceTitle(id, title);
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

// ── A3: one truth, liking the dead track carries the same flag through
//    /api/likes ──
const likeRes = await call('/api/likes', { method: 'POST', body: JSON.stringify({ track: track(DEAD, 'Dead Song') }) });
check('A3 like DEAD ok', likeRes.status === 201, `status ${likeRes.status}`);
const likes = await call('/api/likes').then((r) => r.json());
const likedDead = likes.tracks?.find((t) => t.id === `youtube:${DEAD}`);
check('A3 liked DEAD carries the flag', !!likedDead?.unavailableAt && likedDead.unavailableReason === 'removed', JSON.stringify(likedDead));

// ── A4: a transient failure (bot check / 403) must NOT be mistaken for
//    dead: no 410, and the playlist doesn't flag it ──
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

// ── Part B: replacement search, replace-in-playlist, availability, radio
//    filter. Continues from part A's state: DEAD is flagged unavailable
//    (unavailable.txt = [DEAD]), FLAKY is on transient.txt, and the
//    playlist from A0 holds DEAD, LIVE, FLAKY in that order. ──

// ── B1: availability endpoint ──
const availDead = await call(`/api/tracks/${encodeURIComponent(`youtube:${DEAD}`)}/availability`).then((r) => r.json());
check('B1 DEAD unavailable === true', availDead?.unavailable === true, JSON.stringify(availDead));
check('B1 DEAD reason === removed', availDead?.reason === 'removed', JSON.stringify(availDead));
const availLive = await call(`/api/tracks/${encodeURIComponent(`youtube:${LIVE}`)}/availability`).then((r) => r.json());
check('B1 LIVE unavailable === false', availLive?.unavailable === false, JSON.stringify(availLive));
const availSignedOut = await fetch(`${APP}/api/tracks/${encodeURIComponent(`youtube:${DEAD}`)}/availability`, { redirect: 'manual' });
check('B1 signed-out is 401', availSignedOut.status === 401, `status ${availSignedOut.status}`);

// ── B2: replacements endpoint, same-song candidates first, DEAD excluded,
//    at most 5; a flagged candidate disappears ──
const REPL_BBB = 'bbbbbbbbbbb';
const REPL_EEE = 'eeeeeeeeeee';
const REPL_FFF = 'fffffffffff';

// fff's title ("Dead Song (Live)", see fake-player.sh) shares DEAD's songKey
// even though the fake search lists it last: it must be hoisted to the
// front, ahead of bbb and eee which only share DEAD's title-less bucket.
const repl1 = await call(`/api/tracks/${encodeURIComponent(`youtube:${DEAD}`)}/replacements`).then((r) => r.json());
const repl1Ids = (repl1.candidates ?? []).map((t) => t.id);
check(
  'B2 candidates in order fff (same songKey, hoisted), bbb, eee',
  JSON.stringify(repl1Ids) === JSON.stringify([`youtube:${REPL_FFF}`, `youtube:${REPL_BBB}`, `youtube:${REPL_EEE}`]),
  JSON.stringify(repl1Ids),
);

// eee needs a tracks row before it can be flagged: like it first (upserts),
// then list it as unavailable and stream it once to trigger the 410 + flag.
const likeEeeRes = await call('/api/likes', { method: 'POST', body: JSON.stringify({ track: track(REPL_EEE, 'Replacement Song (Live)') }) });
check('B2 like eee to seed its tracks row', likeEeeRes.status === 201, `status ${likeEeeRes.status}`);
writeList('unavailable.txt', [DEAD, REPL_EEE]);
const streamEee = await call(`/api/youtube/stream/${REPL_EEE}`);
check('B2 stream eee is 410', streamEee.status === 410, `status ${streamEee.status}`);

let repl2Ids = [];
for (let i = 0; i < 20; i++) {
  const repl2 = await call(`/api/tracks/${encodeURIComponent(`youtube:${DEAD}`)}/replacements`).then((r) => r.json());
  repl2Ids = (repl2.candidates ?? []).map((t) => t.id);
  if (!repl2Ids.includes(`youtube:${REPL_EEE}`)) break;
  await sleep(100);
}
check('B2 flagged eee disappears from candidates', !repl2Ids.includes(`youtube:${REPL_EEE}`), JSON.stringify(repl2Ids));

// Put unavailable.txt back to just DEAD for the rest of part B.
writeList('unavailable.txt', [DEAD]);

// ── B3: replace DEAD with bbb: 200, merged false, bbb takes DEAD's index ──
const replaceRes3 = await call(`/api/playlists/${playlistId}/tracks/${encodeURIComponent(`youtube:${DEAD}`)}/replace`, {
  method: 'POST',
  body: JSON.stringify({ track: track(REPL_BBB, 'Replacement Song') }),
});
const replaceBody3 = await replaceRes3.json().catch(() => ({}));
check('B3 replace DEAD->bbb is 200', replaceRes3.status === 200, `status ${replaceRes3.status}`);
check('B3 merged === false', replaceBody3?.merged === false, JSON.stringify(replaceBody3));

const pl3 = await call(`/api/playlists/${playlistId}`).then((r) => r.json());
const ids3 = (pl3.tracks ?? []).map((t) => t.id);
check(
  'B3 playlist is bbb, LIVE, FLAKY (bbb at DEAD\'s old index)',
  JSON.stringify(ids3) === JSON.stringify([`youtube:${REPL_BBB}`, `youtube:${LIVE}`, `youtube:${FLAKY}`]),
  JSON.stringify(ids3),
);

// ── B4: re-add DEAD (lands last, flagged), then replace it with LIVE
//    (already present): merged true, DEAD gone, exactly one LIVE ──
const readdRes = await call(`/api/playlists/${playlistId}/tracks`, {
  method: 'POST',
  body: JSON.stringify({ track: track(DEAD, 'Dead Song') }),
});
check('B4 re-add DEAD ok', readdRes.status === 201, `status ${readdRes.status}`);
const pl4a = await call(`/api/playlists/${playlistId}`).then((r) => r.json());
const dead4a = pl4a.tracks?.find((t) => t.id === `youtube:${DEAD}`);
check('B4 re-added DEAD lands last', pl4a.tracks?.[pl4a.tracks.length - 1]?.id === `youtube:${DEAD}`, JSON.stringify(pl4a.tracks?.map((t) => t.id)));
check('B4 re-added DEAD is flagged', !!dead4a?.unavailableAt, JSON.stringify(dead4a));

const replaceRes4 = await call(`/api/playlists/${playlistId}/tracks/${encodeURIComponent(`youtube:${DEAD}`)}/replace`, {
  method: 'POST',
  body: JSON.stringify({ track: track(LIVE, 'Live Song') }),
});
const replaceBody4 = await replaceRes4.json().catch(() => ({}));
check('B4 replace DEAD->LIVE is 200', replaceRes4.status === 200, `status ${replaceRes4.status}`);
check('B4 merged === true', replaceBody4?.merged === true, JSON.stringify(replaceBody4));

const pl4b = await call(`/api/playlists/${playlistId}`).then((r) => r.json());
const ids4b = (pl4b.tracks ?? []).map((t) => t.id);
check('B4 DEAD gone', !ids4b.includes(`youtube:${DEAD}`), JSON.stringify(ids4b));
check('B4 exactly one LIVE', ids4b.filter((id) => id === `youtube:${LIVE}`).length === 1, JSON.stringify(ids4b));

// ── B5: replacing a track with itself is 400; a second user's replace on
//    this playlist is 404 and leaves it unchanged ──
const selfReplaceRes = await call(`/api/playlists/${playlistId}/tracks/${encodeURIComponent(`youtube:${LIVE}`)}/replace`, {
  method: 'POST',
  body: JSON.stringify({ track: track(LIVE, 'Live Song') }),
});
check('B5 self-replace is 400', selfReplaceRes.status === 400, `status ${selfReplaceRes.status}`);

const other = await user('unavail-other');
const before5 = await call(`/api/playlists/${playlistId}`).then((r) => r.json()).then((p) => (p.tracks ?? []).map((t) => t.id));
const otherReplaceRes = await fetch(`${APP}/api/playlists/${playlistId}/tracks/${encodeURIComponent(`youtube:${LIVE}`)}/replace`, {
  method: 'POST',
  redirect: 'manual',
  headers: { cookie: other.cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ track: track(REPL_BBB, 'Replacement Song') }),
});
check('B5 other user replace is 404', otherReplaceRes.status === 404, `status ${otherReplaceRes.status}`);
const after5 = await call(`/api/playlists/${playlistId}`).then((r) => r.json()).then((p) => (p.tracks ?? []).map((t) => t.id));
check('B5 playlist unchanged', JSON.stringify(before5) === JSON.stringify(after5), `${JSON.stringify(before5)} vs ${JSON.stringify(after5)}`);

// ── B6: recommended radio excludes flagged tracks ──
const recRes = await call(`/api/youtube/recommended?seed=${LIVE}`).then((r) => r.json());
const recIds = (recRes.tracks ?? []).map((t) => t.id);
check('B6 recommended contains LIVE', recIds.includes(`youtube:${LIVE}`), JSON.stringify(recIds));
check('B6 recommended excludes DEAD', !recIds.includes(`youtube:${DEAD}`), JSON.stringify(recIds));

// ── B7: markTrackUnavailable must patch a CHANGED reason on an already
//    -flagged track, not early-return (a track can go geo-blocked today,
//    removed outright tomorrow). Exercised directly against the real
//    function (ts-stub-loader was already registered above), against a
//    track this test seeds and owns exclusively via /api/likes. ──
{
  const GEO_TEST = 'ggggggggggg';
  const likeGeoRes = await call('/api/likes', { method: 'POST', body: JSON.stringify({ track: track(GEO_TEST, 'Geo Test Song') }) });
  check('B7 seed geo-test tracks row', likeGeoRes.status === 201, `status ${likeGeoRes.status}`);

  process.env.POCKETBASE_URL ??= PB;
  process.env.POCKETBASE_ADMIN_EMAIL ??= 'admin@ember.com';
  process.env.POCKETBASE_ADMIN_PASSWORD ??= 'egKa5WNMx3QpuG7';
  const { markTrackUnavailable } = await import('../apps/web/lib/trackAvailability.ts');

  await markTrackUnavailable(`youtube:${GEO_TEST}`, 'geo');
  await markTrackUnavailable(`youtube:${GEO_TEST}`, 'removed');

  const rows = await fetch(
    `${PB}/api/collections/tracks/records?filter=${encodeURIComponent(`external_id = "youtube:${GEO_TEST}"`)}`,
    { headers: { Authorization: tok } },
  ).then((r) => r.json());
  const row = rows.items?.[0];
  check('B7 reason updates geo -> removed on re-flag', row?.unavailable_reason === 'removed', JSON.stringify(row));
}

const failed = out.filter((o) => !o.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
if (failed.length) process.exit(1);
