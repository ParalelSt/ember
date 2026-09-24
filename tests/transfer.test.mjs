/** Transfer: liked songs from a file or a pasted list, at the API
 *  (POST /api/import/upload). The parsers themselves are unit tested
 *  (apps/web/lib/import/sources); what is checked here is the whole path:
 *  upload, preview, a queued `kind: 'liked'` job, the runner liking what it
 *  accepted, the order those likes come back in, the count of songs that were
 *  already liked, and settling an unsure one by hand.
 *
 *      node tests/transfer.test.mjs
 *
 *  Needs the sandbox stack with the fake player, so no search ever leaves the
 *  machine. PocketBase first (8088, this worktree's pb_hooks), then the app
 *  on 3050 with the fake matcher:
 *
 *    /Users/aronmatoic/Documents/Main Projects/spotify-clone-wt/_sandbox/start-pb.sh
 *    cd apps/web && POCKETBASE_URL=http://127.0.0.1:8088 \
 *      POCKETBASE_ADMIN_EMAIL=admin@ember.com POCKETBASE_ADMIN_PASSWORD=egKa5WNMx3QpuG7 \
 *      PYTHON_BIN=/bin/bash PLAYER_SCRIPT="$PWD/../../tests/fake-player.sh" \
 *      FAKE_PLAYER_LOG=/tmp/transfer-calls.log \
 *      FAKE_MATCH_FIXTURE="$PWD/../../tests/fixtures/imports/transfer/ytm-transfer-candidates.json" \
 *      DISCORD_BUG_REPORT_WEBHOOK_URL=http://127.0.0.1:8099/bug \
 *      npx next start -p 3050 &
 *
 *  Then: node tests/transfer.test.mjs */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures/imports/transfer');
const PB = process.env.PB_URL ?? 'http://127.0.0.1:8088';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:3050';
const ADMIN_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL ?? 'admin@ember.com';
const ADMIN_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD ?? 'egKa5WNMx3QpuG7';
const PW = 'TransferTest2026!';

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
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

async function upload(cookie, filename, query = '', destination) {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(readFileSync(path.join(FIXTURES, filename)))], filename));
  if (destination) form.append('destination', destination);
  const r = await fetch(`${APP}/api/import/upload${query}`, { method: 'POST', headers: { cookie }, body: form });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function waitDone(cookie, id, ms = 60_000) {
  const t0 = Date.now();
  for (;;) {
    const r = await get(cookie, `/api/import/jobs/${id}`);
    if (['done', 'failed', 'cancelled'].includes(r.body?.job?.status) || Date.now() - t0 > ms) return r.body;
    await new Promise((res) => setTimeout(res, 400));
  }
}

const liked = async (cookie) => (await get(cookie, '/api/likes')).body?.tracks?.map((t) => t.sourceId) ?? [];

try {
  // ── A. Preview: what is in the file, without starting anything ──
  const previewUser = await user('transfer-preview');
  const a1 = await upload(previewUser, 'exportify.sample.csv', '?preview=1');
  check(
    'A1 an Exportify CSV previews as three songs from Spotify',
    a1.status === 200 && a1.body?.preview?.count === 3 && a1.body.preview.label === 'Liked songs from Spotify' &&
      a1.body.preview.kind === 'csv' && a1.body.preview.order === 'oldest-first',
    `${a1.status} ${JSON.stringify(a1.body)?.slice(0, 200)}`,
  );
  check(
    'A2 the preview shows the first songs so the person can see it read the right file',
    a1.body?.preview?.sample?.[0]?.title === 'Paper Lanterns' && a1.body.preview.sample[0].artist === 'Halcyon Drift',
    JSON.stringify(a1.body?.preview?.sample),
  );
  const a3 = await upload(previewUser, 'YourLibrary.sample.json', '?preview=1');
  check(
    'A3 YourLibrary.json previews, with the repeat and the nameless row dropped',
    a3.status === 200 && a3.body?.preview?.kind === 'spotify-export' && a3.body.preview.count === 4 && a3.body.preview.dropped === 2,
    `${a3.status} ${JSON.stringify(a3.body?.preview)?.slice(0, 200)}`,
  );
  const a4 = await upload(previewUser, 'utf16.sample.csv', '?preview=1');
  check('A4 a UTF-16 file is refused with a reason', a4.status === 422 && /UTF-16/.test(a4.body?.error ?? ''), `${a4.status} ${a4.body?.error}`);
  const a5 = await upload(previewUser, 'no-title-column.sample.csv', '?preview=1');
  check('A5 a file with no song column quotes its own header back', a5.status === 422 && /song column/.test(a5.body?.error ?? ''), `${a5.status} ${a5.body?.error}`);
  const a6 = await fetch(`${APP}/api/import/upload`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'A - B' }),
  });
  check('A6 signed out never starts a transfer', a6.status === 401 || (a6.status === 307 && /\/auth\?/.test(a6.headers.get('location') ?? '')), `${a6.status}`);

  // ── B. The transfer itself ──
  const u = await user('transfer-run');
  // One of the three songs is already liked, so the Done summary can say so.
  const already = {
    id: 'youtube:paperLantr1',
    source: 'youtube',
    sourceId: 'paperLantr1',
    title: 'Paper Lanterns',
    artist: 'Halcyon Drift',
    artistId: null,
    album: null,
    albumId: null,
    durationSec: 214,
    artworkUrl: null,
    streamUrl: '/api/youtube/stream/paperLantr1',
  };
  await postJson(u, '/api/likes', { track: already });

  const b0 = await upload(u, 'exportify.sample.csv');
  check(
    'B0 the upload queues a liked job with no playlist',
    b0.status === 201 && b0.body?.job?.kind === 'liked' && b0.body.job.playlistId === null && b0.body.job.total === 3 &&
      b0.body.job.name === 'Liked songs from Spotify' && b0.body.playlistId === null,
    `${b0.status} ${JSON.stringify(b0.body?.job)?.slice(0, 220)}`,
  );

  const done = await waitDone(u, b0.body?.job?.id);
  const items = done?.items ?? [];
  check(
    'B1 it finishes with one item per song: two matched, one to check',
    done?.job?.status === 'done' && items.length === 3 && items.filter((i) => i.status === 'accepted').length === 2 &&
      items.filter((i) => i.status === 'review').length === 1,
    `${done?.job?.status} ${JSON.stringify(items.map((i) => [i.position, i.status]))}`,
  );
  check(
    'B2 the song the person had already liked is counted as existing, not as new',
    done?.job?.existing === 1 && done?.job?.accepted === 2,
    JSON.stringify({ existing: done?.job?.existing, accepted: done?.job?.accepted }),
  );
  check(
    'B3 the accepted songs are now likes',
    (await liked(u)).includes('slowWeath02') && (await liked(u)).includes('paperLantr1'),
    JSON.stringify(await liked(u)),
  );
  check(
    'B4 the imported like sits below the real one, at the date the file gave it',
    JSON.stringify(await liked(u)) === JSON.stringify(['paperLantr1', 'slowWeath02']),
    JSON.stringify(await liked(u)),
  );

  // ── C. Settling the unsure song by hand ──
  const unsure = items.find((i) => i.status === 'review');
  const pick = unsure?.candidates?.find((c) => c.track.sourceId === 'nineStreet1')?.track;
  const c1 = await postJson(u, `/api/import/items/${unsure?.id}`, { action: 'pick', track: pick });
  check('C1 a pick resolves the item and leaves nothing to review', c1.status === 200 && c1.body?.item?.status === 'resolved' && c1.body?.job?.review === 0,
    `${c1.status} ${JSON.stringify(c1.body?.job)}`);
  check(
    'C2 the picked song is liked, at its own place in the list',
    JSON.stringify(await liked(u)) === JSON.stringify(['paperLantr1', 'nineStreet1', 'slowWeath02']),
    JSON.stringify(await liked(u)),
  );
  const c3 = await get(u, '/api/import/jobs');
  check('C3 the sidebar list carries the transfer, with no playlist of its own',
    c3.body?.jobs?.some((j) => j.id === b0.body?.job?.id && j.kind === 'liked' && j.playlistId === null),
    JSON.stringify(c3.body?.jobs?.map((j) => [j.id, j.kind, j.playlistId])));

  // ── D. A pasted list, whose songs carry no dates of their own ──
  const pasteUser = await user('transfer-paste');
  await postJson(pasteUser, '/api/likes', { track: { ...already, id: 'youtube:realLike001', sourceId: 'realLike001' } });
  const d1 = await postJson(pasteUser, '/api/import/upload', { text: 'Halcyon Drift - Paper Lanterns\nNadia Okonkwo - Slow Weather, Pt. 2' });
  check('D1 a pasted list queues a transfer too', d1.status === 201 && d1.body?.job?.kind === 'liked' && d1.body.job.total === 2 &&
    d1.body.job.source === 'paste', `${d1.status} ${JSON.stringify(d1.body?.job)?.slice(0, 200)}`);
  const d1done = await waitDone(pasteUser, d1.body?.job?.id);
  check('D2 its songs are liked', d1done?.job?.status === 'done' && d1done?.job?.accepted >= 1, JSON.stringify(d1done?.job));
  const pasteLikes = await liked(pasteUser);
  check('D3 songs with no date of their own land below the likes made in Ember', pasteLikes[0] === 'realLike001', JSON.stringify(pasteLikes));

  // ── E. Starts are rate limited per user, by the hour; previews are free ──
  // (bughunt W06: a preview fires on every pause in typing, so it no longer
  // spends the 5-per-hour limit.)
  const limitUser = await user('transfer-limit');
  const previews = [];
  for (let i = 0; i < 6; i++) previews.push((await postJson(limitUser, '/api/import/upload?preview=1', { text: `A${i} - B${i}` })).status);
  check('E1 previews never spend the hourly limit', previews.every((s) => s === 200), JSON.stringify(previews));
  const starts = [];
  for (let i = 0; i < 6; i++) starts.push((await postJson(limitUser, '/api/import/upload', { text: `A${i} - B${i}` })).status);
  check('E2 the sixth start within the hour is a 429', starts.filter((s) => s === 201).length === 5 && starts[5] === 429, JSON.stringify(starts));
} finally {
  for (const id of created) {
    await fetch(`${PB}/api/collections/users/records/${id}`, { method: 'DELETE', headers: { Authorization: tok } }).catch(() => {});
  }
}

const failed = out.filter((c) => !c.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
process.exit(failed.length ? 1 : 0);
