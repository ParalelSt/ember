/** Liked songs come back in `liked_at` order, and the heart stamps it.
 *
 *      node tests/likes-order.test.mjs
 *
 *  Needs the sandbox stack: PocketBase on 8088 (with the pb_hooks of this
 *  worktree, so ensure_likes_fields.pb.js has run) and the app on 3050.
 *
 *    /Users/aronmatoic/Documents/Main Projects/spotify-clone-wt/_sandbox/start-pb.sh
 *    SINK=1 /Users/aronmatoic/Documents/Main Projects/spotify-clone-wt/_sandbox/start-app.sh
 *
 *  Then: node tests/likes-order.test.mjs
 *
 *  The order is what a transfer depends on: an imported like is written with
 *  a date below the person's real likes, so it has to be the date and not
 *  PocketBase's own `created` that the list is sorted by. */

const PB = process.env.PB_URL ?? 'http://127.0.0.1:8088';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:3050';
const ADMIN_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL ?? 'admin@ember.com';
const ADMIN_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD ?? 'egKa5WNMx3QpuG7';
const PW = 'LikesOrder2026!';

const out = [];
const check = (name, pass, detail = '') => {
  out.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
};

async function adminToken() {
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const r = await fetch(PB + p, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    if (r.ok) return (await r.json()).token;
  }
  throw new Error('no admin');
}
const tok = await adminToken();
const created = [];

async function user(label) {
  const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e5)}@ember.test`;
  const rec = await fetch(`${PB}/api/collections/users/records`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: tok },
    body: JSON.stringify({ email, password: PW, passwordConfirm: PW, name: label, verified: true }),
  }).then((r) => r.json());
  created.push(rec.id);
  const auth = await fetch(`${PB}/api/collections/users/auth-with-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: email, password: PW }),
  }).then((r) => r.json());
  return { id: rec.id, cookie: `pb_auth=${encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }))}` };
}

const track = (id) => ({
  id: `youtube:${id}`,
  source: 'youtube',
  sourceId: id,
  title: `Song ${id}`,
  artist: 'Order Test',
  artistId: null,
  album: null,
  albumId: null,
  durationSec: 200,
  artworkUrl: null,
  streamUrl: `/api/youtube/stream/${id}`,
});

/** The `tracks` row for a video id, created if the app has not cached it. */
async function upsertTrackRow(videoId) {
  const found = await fetch(
    `${PB}/api/collections/tracks/records?filter=${encodeURIComponent(`external_id = "youtube:${videoId}"`)}`,
    { headers: { Authorization: tok } },
  ).then((r) => r.json());
  if (found.items?.[0]) return found.items[0].id;
  const t = track(videoId);
  const made = await fetch(`${PB}/api/collections/tracks/records`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: tok },
    body: JSON.stringify({ external_id: t.id, source: t.source, source_id: t.sourceId, title: t.title, artist: t.artist }),
  }).then((r) => r.json());
  return made.id;
}

const post = (cookie, path, body) =>
  fetch(APP + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const get = (cookie, path) =>
  fetch(APP + path, { headers: { cookie } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

try {
  const u = await user('likes-order');

  const first = await post(u.cookie, '/api/likes', { track: track('likeOrder01') });
  const second = await post(u.cookie, '/api/likes', { track: track('likeOrder02') });
  check('A1 liking a song answers 201', first.status === 201 && second.status === 201, `${first.status} ${second.status}`);

  const list = await get(u.cookie, '/api/likes');
  check(
    'A2 the newest like is first',
    JSON.stringify(list.body?.tracks?.map((t) => t.sourceId)) === JSON.stringify(['likeOrder02', 'likeOrder01']),
    JSON.stringify(list.body?.tracks?.map((t) => t.sourceId)),
  );

  const rows = await fetch(`${PB}/api/collections/likes/records?filter=${encodeURIComponent(`user = "${u.id}"`)}&perPage=50`, {
    headers: { Authorization: tok },
  }).then((r) => r.json());
  check(
    'A3 the heart stamps liked_at and origin user',
    rows.items?.length === 2 && rows.items.every((r) => !!r.liked_at && r.origin === 'user'),
    JSON.stringify(rows.items?.map((r) => ({ liked_at: r.liked_at, origin: r.origin }))),
  );

  // What a transfer does: a like dated below the real ones sorts below them,
  // whatever PocketBase's own `created` says.
  const trackId = await upsertTrackRow('likeOrder03');
  const backdated = await fetch(`${PB}/api/collections/likes/records`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: tok },
    body: JSON.stringify({ user: u.id, track: trackId, liked_at: '2001-01-01 00:00:00.000Z', origin: 'import' }),
  });
  check('A4 an imported like can be written with its own date', backdated.ok, String(backdated.status));

  const withImport = await get(u.cookie, '/api/likes');
  check(
    'A5 an imported like dated in the past sorts below the real ones',
    JSON.stringify(withImport.body?.tracks?.map((t) => t.sourceId)) === JSON.stringify(['likeOrder02', 'likeOrder01', 'likeOrder03']),
    JSON.stringify(withImport.body?.tracks?.map((t) => t.sourceId)),
  );
} finally {
  for (const id of created) {
    await fetch(`${PB}/api/collections/users/records/${id}`, { method: 'DELETE', headers: { Authorization: tok } }).catch(() => {});
  }
}

const failed = out.filter((c) => !c.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
process.exit(failed.length ? 1 : 0);
