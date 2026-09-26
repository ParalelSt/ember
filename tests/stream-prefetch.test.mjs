/** The stream route's `?prefetch=1` contract, end to end (docs/prefetch.md).
 *
 *      node tests/stream-prefetch.test.mjs   # or: npm run test:stream-prefetch
 *
 *  Checks, against a real server with a fake yt-dlp:
 *  - a cached song: ten prefetches a minute are served (private, no-store),
 *    the 11th is 429 with Retry-After, and a normal play still works;
 *  - a cold song while another download runs: 503 + Retry-After 30, and the
 *    song is warmed at once so the retry finds it on disk;
 *  - a cold song on an idle host: downloaded and served;
 *  - the global cap: three cold plays at once run two at a time;
 *  - an uploaded WAV: the same per-listener limit (needs PocketBase).
 *
 *  Its own server, with a fake player whose downloads take 3 s:
 *
 *      PYTHON_BIN=/bin/bash PLAYER_SCRIPT="$PWD/tests/fake-player.sh" \
 *      FAKE_DOWNLOAD_SECONDS=3 MAX_CONCURRENT_DOWNLOADS=2 \
 *      MUSIC_DIR=/tmp/ember-prefetch-test/music \
 *      FAKE_PLAYER_LOG=/tmp/ember-prefetch-test/calls.log \
 *      POCKETBASE_URL=http://127.0.0.1:8086 npx next start -p 3053
 *
 *  Env: APP_URL (default http://127.0.0.1:3053), MUSIC_DIR, FAKE_PLAYER_LOG,
 *  PB_URL (default http://127.0.0.1:8086; SKIP_UPLOADS=1 skips that part). */
import fs from 'node:fs';
import path from 'node:path';
import { memberCookie } from './sandbox-member.mjs';

const APP = process.env.APP_URL ?? 'http://127.0.0.1:3053';
const MUSIC = process.env.MUSIC_DIR ?? '/tmp/ember-prefetch-test/music';
const LOG = process.env.FAKE_PLAYER_LOG ?? '/tmp/ember-prefetch-test/calls.log';
const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8086';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL ?? 'admin@ember.com';
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD ?? 'egKa5WNMx3QpuG7';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A fresh 11-char id per run, so a rerun never finds last run's file. */
const run = `${process.pid.toString(36)}${Date.now().toString(36)}`.slice(-7);
const vid = (tag) => `${tag}${run}`.padEnd(11, 'x').slice(0, 11);

/** Every call is its own "listener" unless it names one, keyed by IP.
 *  A song not on disk is fetched for members only (security audit M2), so
 *  from step 2 on each listener address is also a signed-in member of its
 *  own; step 1 (a song on disk) stays signed out, which must still work. */
const members = new Map();
async function signIn(ip) {
  if (!members.has(ip)) members.set(ip, await memberCookie({ pb: PB_URL, label: `prefetch-${ip.replace(/\./g, '-')}` }));
  return members.get(ip);
}
const stream = async (id, { prefetch = true, ip = '10.9.0.1', member = true } = {}) => {
  const headers = { 'x-forwarded-for': ip };
  if (member) headers.cookie = await signIn(ip);
  return fetch(`${APP}/api/youtube/stream/${id}${prefetch ? '?prefetch=1' : ''}`, { headers });
};

const downloadsOf = (id) =>
  (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '').split('\n').filter((l) => l === `download ${id}`).length;

fs.mkdirSync(MUSIC, { recursive: true });

// 1. A cached song and the per-listener limit.
{
  const cached = vid('pc');
  fs.writeFileSync(path.join(MUSIC, `${cached}.m4a`), 'CACHED-AUDIO');
  // Random, so a rerun inside the minute is a new listener to the limiter.
  const ip = `10.9.1.${1 + Math.floor(Math.random() * 250)}`;
  const statuses = [];
  let privateHeader = true;
  for (let i = 0; i < 10; i++) {
    const res = await stream(cached, { ip, member: false });
    statuses.push(res.status);
    if (res.headers.get('cache-control') !== 'private, no-store') privateHeader = false;
    await res.arrayBuffer();
  }
  check('ten prefetches of a cached song are served', statuses.every((s) => s === 200), statuses.join(','));
  check('a prefetched file is private, no-store', privateHeader);
  const limited = await stream(cached, { ip, member: false });
  const retry = Number(limited.headers.get('retry-after'));
  check('the 11th prefetch in a minute is 429', limited.status === 429, String(limited.status));
  check('the 429 carries Retry-After', retry >= 1 && retry <= 60, String(retry));
  const play = await stream(cached, { ip, prefetch: false, member: false });
  check('a normal play from the same listener still works', play.status === 200 && (await play.text()) === 'CACHED-AUDIO');
  check('a normal play is not marked no-store', play.headers.get('cache-control') !== 'private, no-store');
}

// 2. A cold prefetch while another download runs.
{
  const playing = vid('pp');
  const wanted = vid('pw');
  // Both listeners signed in up front, so the busy check below is timed
  // against the download, not a PocketBase round trip.
  await signIn('10.9.2.1');
  await signIn('10.9.2.2');
  const playReq = stream(playing, { prefetch: false, ip: '10.9.2.1' });
  await sleep(500);
  const busy = await stream(wanted, { ip: '10.9.2.2' });
  const body = await busy.json().catch(() => null);
  check('a cold prefetch on a busy host is 503', busy.status === 503, String(busy.status));
  check('the 503 says Retry-After 30', busy.headers.get('retry-after') === '30', busy.headers.get('retry-after') ?? 'none');
  check('the 503 body names the cause', body?.cause === 'busy', JSON.stringify(body));
  const played = await playReq;
  check('the listener who was playing still gets the song', played.status === 200, String(played.status));
  await played.arrayBuffer();

  // Warmed at once (no 90 s wait), so the retry finds it on disk.
  let warmed = false;
  for (let i = 0; i < 40 && !warmed; i++) {
    await sleep(250);
    warmed = downloadsOf(wanted) === 1 && fs.existsSync(path.join(MUSIC, `${wanted}.m4a`)) && !(await isStillDownloading(wanted));
  }
  check('the refused song is warmed right away', warmed, `downloads=${downloadsOf(wanted)}`);
  const retry = await stream(wanted, { ip: '10.9.2.2' });
  check('the retry is served from disk', retry.status === 200 && (await retry.text()) === `FAKE-AUDIO-${wanted}`);
  check('no second download for the retry', downloadsOf(wanted) === 1, String(downloadsOf(wanted)));
}

/** A finished fake download writes FAKE-AUDIO-<id>; before that the file is missing or partial. */
async function isStillDownloading(id) {
  const p = path.join(MUSIC, `${id}.m4a`);
  return !fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== `FAKE-AUDIO-${id}`;
}

// 3. A cold prefetch on an idle host.
{
  await sleep(4000); // let any warm from step 2 settle
  const cold = vid('pi');
  const res = await stream(cold, { ip: '10.9.3.1' });
  check('a cold prefetch on an idle host is downloaded and served', res.status === 200 && (await res.text()) === `FAKE-AUDIO-${cold}`, String(res.status));
}

// 4. The global cap: three cold plays, two at a time.
{
  const ids = [vid('g1'), vid('g2'), vid('g3')];
  for (let i = 0; i < 3; i++) await signIn(`10.9.4.${i}`);
  const t0 = Date.now();
  const done = await Promise.all(ids.map(async (id, i) => {
    const res = await stream(id, { prefetch: false, ip: `10.9.4.${i}` });
    await res.arrayBuffer();
    return { status: res.status, ms: Date.now() - t0 };
  }));
  const times = done.map((d) => d.ms).sort((a, b) => a - b);
  check('three cold plays all succeed', done.every((d) => d.status === 200), done.map((d) => d.status).join(','));
  check('two run at once, the third waits for a slot', times[1] < 5000 && times[2] >= 5500, times.join(','));
}

// 5. An uploaded song shares the per-listener limit.
if (process.env.SKIP_UPLOADS !== '1') {
  try {
    await checkUploads();
  } catch (e) {
    check('uploads part ran', false, e.message);
  }
}

async function checkUploads() {
  const token = await adminToken();
  const password = 'Prefetch2026!';
  const email = `prefetch-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
  const created = await fetch(`${PB_URL}/api/collections/users/records`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: token },
    body: JSON.stringify({ email, password, passwordConfirm: password, name: 'Prefetch Tester', verified: true }),
  });
  if (!created.ok) throw new Error(`could not create test user: ${created.status}`);
  const userId = (await created.json()).id;
  try {
    const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: email, password }),
    }).then((r) => r.json());
    const cookie = `pb_auth=${encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }))}`;
    const form = new FormData();
    form.append('file', new Blob([makeWav()], { type: 'audio/wav' }), 'Prefetch.wav');
    form.append('title', 'Prefetch Song');
    form.append('artist', 'Prefetch Artist');
    form.append('durationSec', '2');
    const up = await fetch(`${APP}/api/uploads`, { method: 'POST', body: form, headers: { cookie } });
    if (!up.ok) throw new Error(`upload failed: ${up.status}`);
    const { tracks } = await fetch(`${APP}/api/uploads`, { headers: { cookie } }).then((r) => r.json());
    const url = `${APP}${tracks[0].streamUrl}`;
    const statuses = [];
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${url}?prefetch=1`, { headers: { cookie } });
      statuses.push(res.status);
      await res.arrayBuffer();
    }
    check('ten prefetches of an upload are served', statuses.every((s) => s === 200), statuses.join(','));
    const limited = await fetch(`${url}?prefetch=1`, { headers: { cookie } });
    check('the 11th upload prefetch is 429 with Retry-After', limited.status === 429 && Number(limited.headers.get('retry-after')) >= 1,
      `${limited.status} retry-after=${limited.headers.get('retry-after')}`);
    const play = await fetch(url, { headers: { cookie } });
    check('a normal play of the upload still works', play.status === 200, String(play.status));
    await play.arrayBuffer();
  } finally {
    await fetch(`${PB_URL}/api/collections/users/records/${userId}`, { method: 'DELETE', headers: { Authorization: token } }).catch(() => {});
  }
}

async function adminToken() {
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const res = await fetch(`${PB_URL}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: PB_ADMIN_EMAIL, password: PB_ADMIN_PASSWORD }),
    });
    if (res.ok) return (await res.json()).token;
  }
  throw new Error('could not authenticate as PB admin');
}

function makeWav(seconds = 2, sampleRate = 8000) {
  const samples = seconds * sampleRate;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
