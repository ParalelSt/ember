/** Transfer: the person's own liked songs on YouTube Music, at the API
 *  (POST /api/import/liked/ytmusic). The parser and the route are unit tested
 *  (apps/web/lib/import/sources/ytmusicLiked.test.ts and the route's own
 *  test); what is checked here is the whole path against a real PocketBase:
 *  the preview, a queued `kind: 'liked'` job whose items need no search, the
 *  likes it makes, the rate limit, and the two promises about the paste (it
 *  travels on the helper's stdin, and no part of it comes back).
 *
 *      node tests/transfer-ytmusic.test.mjs
 *
 *  No account and no credentials: the headers below are invented and the
 *  player is the fake one, which answers `liked` from a fixture and writes
 *  whatever it was handed on stdin to $FAKE_LIKED_STDIN.
 *
 *    /Users/aronmatoic/Documents/Main Projects/spotify-clone-wt/_sandbox/start-pb.sh
 *    cd apps/web && POCKETBASE_URL=http://127.0.0.1:8088 \
 *      POCKETBASE_ADMIN_EMAIL=admin@ember.com POCKETBASE_ADMIN_PASSWORD=egKa5WNMx3QpuG7 \
 *      PYTHON_BIN=/bin/bash PLAYER_SCRIPT="$PWD/../../tests/fake-player.sh" \
 *      FAKE_PLAYER_LOG=/tmp/transfer-ytm-calls.log \
 *      FAKE_LIKED_STDIN=/tmp/transfer-ytm-stdin.txt \
 *      npx next start -p 3050 &
 *
 *  Then: node tests/transfer-ytmusic.test.mjs */
import { existsSync, readFileSync, rmSync } from 'node:fs';

const PB = process.env.PB_URL ?? 'http://127.0.0.1:8088';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:3050';
const ADMIN_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL ?? 'admin@ember.com';
const ADMIN_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD ?? 'egKa5WNMx3QpuG7';
const STDIN_FILE = process.env.FAKE_LIKED_STDIN ?? '/tmp/transfer-ytm-stdin.txt';
const PW = 'TransferTest2026!';

// Invented, and shaped like the real thing: a Cookie line with the names that
// identify an account, plus the authuser ytmusicapi insists on.
const SECRET = 'not-a-real-session-value';
const HEADERS = [
  'accept: */*',
  `authorization: SAPISIDHASH 1758500000_${SECRET}`,
  `cookie: SAPISID=${SECRET}; __Secure-3PAPISID=${SECRET}; HSID=${SECRET}`,
  'user-agent: Mozilla/5.0',
  'x-goog-authuser: 0',
].join('\n');

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
  return `pb_auth=${encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }))}`;
}

const get = (cookie, p) =>
  fetch(APP + p, { headers: { cookie } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const postJson = (cookie, p, body) =>
  fetch(APP + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  }).then(async (r) => {
    const text = await r.text();
    return { status: r.status, text, body: JSON.parse(text || 'null') };
  });

async function waitDone(cookie, id, ms = 60_000) {
  const t0 = Date.now();
  for (;;) {
    const r = await get(cookie, `/api/import/jobs/${id}`);
    if (['done', 'failed', 'cancelled'].includes(r.body?.job?.status) || Date.now() - t0 > ms) return r.body;
    await new Promise((res) => setTimeout(res, 400));
  }
}

const liked = async (cookie) => (await get(cookie, '/api/likes')).body?.tracks?.map((t) => t.sourceId) ?? [];
const transfer = (cookie, query = '', body = { secret: HEADERS }) =>
  postJson(cookie, `/api/import/liked/ytmusic${query}`, body);

try {
  // ── A. The paste has to look like headers before anything is spent on it ──
  const gateUser = await user('ytm-liked-gate');
  const a1 = await transfer(gateUser, '', {});
  check('A1 an empty body asks for the headers', a1.status === 400 && /Paste your YouTube Music/.test(a1.body?.error ?? ''), `${a1.status} ${a1.body?.error}`);
  const a2 = await transfer(gateUser, '', { secret: 'cookie: YSC=abc\nx-goog-authuser: 0' });
  check('A2 a signed-out Cookie line is refused', a2.status === 400 && /signed-out/.test(a2.body?.error ?? ''), `${a2.status} ${a2.body?.error}`);
  const a3 = await fetch(`${APP}/api/import/liked/ytmusic`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: HEADERS }),
  });
  check('A3 signed out never starts a transfer', a3.status === 401 || (a3.status === 307 && /\/auth\?/.test(a3.headers.get('location') ?? '')), `${a3.status}`);

  // ── B. Preview, then the transfer itself ──
  rmSync(STDIN_FILE, { force: true });
  const u = await user('ytm-liked-run');
  const b1 = await transfer(u, '?preview=1');
  check(
    'B1 the preview names the source and counts the songs',
    b1.status === 200 && b1.body?.preview?.kind === 'ytmusic-liked' && b1.body.preview.count === 3 &&
      b1.body.preview.label === 'Liked songs from YouTube Music' && b1.body.preview.order === 'newest-first',
    `${b1.status} ${JSON.stringify(b1.body?.preview)?.slice(0, 200)}`,
  );
  check(
    'B2 the headers reached the helper on stdin, not in its arguments',
    existsSync(STDIN_FILE) && readFileSync(STDIN_FILE, 'utf8').includes(SECRET),
    existsSync(STDIN_FILE) ? 'stdin file written' : 'no stdin file',
  );
  check('B3 no part of the paste comes back in the answer', !b1.text.includes(SECRET), b1.text.slice(0, 120));

  const b4 = await transfer(u);
  check(
    'B4 it queues a liked job with no playlist',
    b4.status === 201 && b4.body?.job?.kind === 'liked' && b4.body.job.playlistId === null && b4.body.job.total === 3 &&
      b4.body.job.source === 'ytmusic' && b4.body.job.name === 'Liked songs from YouTube Music',
    `${b4.status} ${JSON.stringify(b4.body?.job)?.slice(0, 220)}`,
  );

  const done = await waitDone(u, b4.body?.job?.id);
  const items = done?.items ?? [];
  check(
    'B5 every song is accepted with no searching at all',
    done?.job?.status === 'done' && done?.job?.accepted === 3 && done?.job?.review === 0 && done?.job?.missing === 0 &&
      items.every((i) => i.status === 'accepted' && i.confidence === 100),
    `${done?.job?.status} ${JSON.stringify(items.map((i) => [i.position, i.status, i.confidence]))}`,
  );
  check(
    'B6 the likes are the songs YouTube Music named, newest of the source first',
    JSON.stringify(await liked(u)) === JSON.stringify(['liked000001', 'liked000002', 'liked000003']),
    JSON.stringify(await liked(u)),
  );
  const log = existsSync(process.env.FAKE_PLAYER_LOG ?? '/tmp/transfer-ytm-calls.log')
    ? readFileSync(process.env.FAKE_PLAYER_LOG ?? '/tmp/transfer-ytm-calls.log', 'utf8')
    : '';
  check('B7 the helper was never asked to match anything', !/^match /m.test(log), log.split('\n').slice(-5).join(' | '));

  // ── C. What a failed read says ──
  // The route answers with the helper's sentence and nothing else; the fake
  // player produces one when FAKE_LIKED_ERROR is set, so this check only runs
  // when the sandbox was started that way.
  if (process.env.FAKE_LIKED_ERROR) {
    const c1 = await transfer(await user('ytm-liked-fail'));
    check('C1 a refused read is a sentence, not a stack', c1.status >= 400 && /YouTube Music/.test(c1.body?.error ?? '') && !/Traceback|at Object/.test(c1.text),
      `${c1.status} ${c1.body?.error}`);
  }

  // ── D. Three an hour, per person ──
  const limitUser = await user('ytm-liked-limit');
  const tries = [];
  for (let i = 0; i < 4; i++) tries.push((await transfer(limitUser, '?preview=1')).status);
  check('D1 the fourth read within the hour is a 429', tries.filter((s) => s === 200).length === 3 && tries[3] === 429, JSON.stringify(tries));
} finally {
  for (const id of created) {
    await fetch(`${PB}/api/collections/users/records/${id}`, { method: 'DELETE', headers: { Authorization: tok } }).catch(() => {});
  }
}

const failed = out.filter((c) => !c.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
process.exit(failed.length ? 1 : 0);
