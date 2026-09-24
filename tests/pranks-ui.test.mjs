/** Admin pranks (plan Tasks 1 to 3, 7 and 8): two browser contexts, an
 *  admin on the Control room page and a target.
 *
 *      npm i -D playwright-core
 *      PB_URL=http://127.0.0.1:8089 APP_URL=http://127.0.0.1:3051 node tests/pranks-ui.test.mjs
 *
 *  The target plays an uploaded song; the admin page shows what they play in
 *  words; a ping reaches the target and is acknowledged within a couple of
 *  seconds, with nothing shown on the target's side. The admin uploads a
 *  short generated sound from the page, picks the target and sends it: the
 *  target's page plays it on a second audio element while the music element
 *  drops to 30% and comes back, and the log says done. A repeat started
 *  while the target is paused logs a skip that does not count against the
 *  hour, and its Stop ends it; with the music back on, a repeat every minute
 *  lands twice (ducking each time), Stop everything ends it for good, and
 *  the page's off switch blocks sending. The library refuses a renamed image
 *  and a too-long sound; its media URL answers only admins and the target of
 *  a live prank. The target cannot read acknowledged rows or write any.
 *  Members get 403, the switch gives 409, the hourly cap and the 15 s sound
 *  gap 429, a sound for a paused person is skipped, and a ping to someone
 *  offline reads as expired after 45 s.
 *
 *  Needs a sandbox: PocketBase (PB_URL) with pb_hooks/ensure_pranks.pb.js
 *  loaded, and the app (APP_URL) built from this tree with MUSIC_DIR set and
 *  PRANK_TICK_INTERVAL_MS=1000 (the repeat tick every second rather than
 *  every 5 s; the 60 s between plays is real, so the run takes about 3 min).
 *  Set CHROME_PATH to pick a browser. */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('This test needs playwright-core:\n\n  npm i -D playwright-core\n');
  process.exit(2);
}

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8089';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3051';
const PASSWORD = 'PrankTest2026!';

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = path.join(process.env.HOME ?? '', 'Library/Caches/ms-playwright');
  if (!fs.existsSync(root)) throw new Error('no Playwright browser cache, set CHROME_PATH');
  for (const d of fs.readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const found = execSync(
      `find "${path.join(root, d)}" -maxdepth 6 -type f \\( -name "Google Chrome for Testing" -o -name "Chromium" \\) 2>/dev/null | head -1`,
      { encoding: 'utf8' },
    ).trim();
    if (found) return found;
  }
  throw new Error('no Chromium binary found, set CHROME_PATH');
}

async function adminToken() {
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const res = await fetch(`${PB_URL}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: 'admin@ember.com', password: 'egKa5WNMx3QpuG7' }) });
    if (res.ok) return (await res.json()).token;
  }
  throw new Error('could not authenticate as PB admin');
}

const su = await adminToken();
const run = `${process.pid}-${Math.floor(Math.random() * 1e6)}`;
const pbHeaders = { 'content-type': 'application/json', Authorization: su };

/** A fresh user, signed in: id, token and the pb_auth cookie value. */
async function member(tag, { admin = false, name } = {}) {
  // No "prank" in the address: the target's own page shows it.
  const email = `spine-${tag}-${run}@ember.test`;
  await fetch(`${PB_URL}/api/collections/users/records`, { method: 'POST', headers: pbHeaders,
    body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name: name ?? `Prank ${tag}`, verified: true, is_admin: admin }) });
  const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PASSWORD }) })
    .then((r) => r.json());
  return { id: auth.record.id, token: auth.token, cookie: encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record })) };
}

const app = (who, p, init = {}) => fetch(`${APP_URL}${p}`, { ...init,
  headers: { 'content-type': 'application/json', cookie: `pb_auth=${who.cookie}`, ...(init.headers ?? {}) } });
const pbRow = (id) => fetch(`${PB_URL}/api/collections/pranks/records/${id}`, { headers: pbHeaders }).then((r) => r.json());

function makeWav(seconds = 180, sampleRate = 8000) {
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

async function uploadSong(who, title) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(makeWav())], { type: 'audio/wav' }), 'song.wav');
  form.append('title', title);
  form.append('artist', 'Test Band');
  const res = await fetch(`${APP_URL}/api/uploads`, { method: 'POST', body: form, headers: { cookie: `pb_auth=${who.cookie}` } });
  if (!res.ok) throw new Error(`could not seed a song: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).track;
}

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── people ────────────────────────────────────────────────────────────────
const boss = await member('admin', { admin: true, name: `Boss ${run}` });
const target = await member('target', { name: `Target ${run}` });
const offline = await member('offline', { name: `Offline ${run}` });
const outsider = await member('outsider');

// Make sure the switch is on (a previous run may have left it off).
await app(boss, '/api/admin/pranks/settings', { method: 'PATCH', body: JSON.stringify({ enabled: true }) });

// The switch first: turning it off cancels whatever is pending.
{
  const waiting = (await app(boss, '/api/admin/pranks', { method: 'POST', body: JSON.stringify({ targetId: offline.id, kind: 'ping' }) })
    .then((r) => r.json())).prank;
  const off = await app(boss, '/api/admin/pranks/settings', { method: 'PATCH', body: JSON.stringify({ enabled: false }) });
  const offBody = await off.json();
  check('the switch turns off and cancels what was waiting', offBody.enabled === false && offBody.cancelled >= 1
    && (await pbRow(waiting.id)).status === 'cancelled', JSON.stringify(offBody));
  const res = await app(boss, '/api/admin/pranks', { method: 'POST', body: JSON.stringify({ targetId: target.id, kind: 'ping' }) });
  check('with the switch off a prank is refused (409)', res.status === 409, (await res.json()).error);
  const on = await app(boss, '/api/admin/pranks/settings', { method: 'PATCH', body: JSON.stringify({ enabled: true }) });
  check('the switch turns back on', (await on.json()).enabled === true);
}

// The expiry case runs in the background of everything else: 45 s.
const offlineSent = await app(boss, '/api/admin/pranks', { method: 'POST', body: JSON.stringify({ targetId: offline.id, kind: 'ping' }) });
const offlinePrank = (await offlineSent.json()).prank;
const offlineAt = Date.now();
check('a ping to an offline person is accepted (201)', offlineSent.status === 201);

const song = await uploadSong(target, `Quiet Song ${run}`);

const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
async function context(who) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
  await ctx.addCookies([{ name: 'pb_auth', value: who.cookie, domain: new URL(APP_URL).hostname, path: '/' }]);
  const page = await ctx.newPage();
  const consoleLines = [];
  page.on('console', (m) => consoleLines.push(m.text()));
  return { page, consoleLines };
}

// ── target plays ──────────────────────────────────────────────────────────
const t = await context(target);
await t.page.goto(`${APP_URL}/library/uploads`, { waitUntil: 'networkidle' });
await t.page.getByText(song.title, { exact: true }).first().click({ clickCount: 2 });
const playing = await t.page.waitForFunction(() => {
  const a = [...document.querySelectorAll('audio')].find((x) => x.src);
  return a && !a.paused && a.currentTime > 0.5;
}, null, { timeout: 15_000 }).then(() => true, () => false);
check('the target is playing the uploaded song', playing);

// Presence: the heartbeat goes out on play.
let line = '';
for (let i = 0; i < 20 && !line.startsWith('Playing'); i++) {
  const body = await app(boss, '/api/admin/pranks/people').then((r) => r.json());
  line = body.people?.find((p) => p.id === target.id)?.line ?? '';
  if (!line.startsWith('Playing')) await sleep(500);
}
check('the admin sees what the target plays, in words', line.startsWith(`Playing “${song.title}” by Test Band`) && line.endsWith('in the browser'), line);
check('the people line carries no ids', !line.includes(song.id) && !line.includes('upload:'));

// ── the Control room, and a ping ──────────────────────────────────────────
const a = await context(boss);
await a.page.goto(`${APP_URL}/admin/pranks`, { waitUntil: 'networkidle' });
const regions = await Promise.all(['People', 'Compose', 'Sound library', 'Log']
  .map((h) => a.page.getByRole('heading', { name: h, exact: true }).isVisible()));
check('the admin page is the Control room: people, compose, library, log', regions.every(Boolean), regions.join(' '));
check('the page offers no song swap', !/swap/i.test((await a.page.textContent('body')) ?? ''));
const targetName = `Target ${run}`;
const personLine = await a.page.locator('li', { hasText: targetName }).getByTestId('presence-line').textContent({ timeout: 10_000 }).catch(() => '');
check('the admin page shows the target playing', (personLine ?? '').startsWith('Playing'), personLine ?? '');

// The page sends sounds only; a ping (the reachability check) goes straight
// to the route.
const createdRes = await app(boss, '/api/admin/pranks', { method: 'POST', body: JSON.stringify({ targetId: target.id, kind: 'ping' }) });
const sentAt = Date.now();
const prank = (await createdRes.json()).prank;
check('Ping creates a prank (201)', createdRes.status === 201);

let row = null;
while (Date.now() - sentAt < 8_000) {
  row = await pbRow(prank.id);
  if (row.status !== 'pending') break;
  await sleep(150);
}
const latency = Date.now() - sentAt;
check('the target acknowledges the ping within a couple of seconds', row?.status === 'delivered' && latency < 4_000, `${row?.status} after ${latency} ms`);
check('the ack names the engine and the app version', row?.engine === 'web' && typeof row?.app_version === 'string' && row.app_version.length > 0, `${row?.engine} ${row?.app_version}`);

const logged = await a.page.getByText(`pinged ${targetName}: delivered in the browser`).first()
  .waitFor({ timeout: 8_000 }).then(() => true, () => false);
check('the admin log says delivered, in words', logged);

// ── the victim is never told ──────────────────────────────────────────────
await t.page.waitForTimeout(500);
const targetText = (await t.page.textContent('body')) ?? '';
// Song titles in the sandbox may say anything, so look for the feature's own
// words and for any toast at all rather than the bare word "prank".
const mention = /.{0,30}(pranked|pinged|\bping\b|from an admin|Pranks on you).{0,30}/i.exec(targetText)?.[0];
check('nothing on the target page mentions the ping', !mention, mention);
check('no toast on the target side', (await t.page.locator('[data-sonner-toast]').count()) === 0);
check('nothing in the target console mentions a prank', !t.consoleLines.some((l) => /prank/i.test(l)), t.consoleLines.filter((l) => /prank/i.test(l)).join(' | '));
const stillPlaying = await t.page.evaluate(() => {
  const el = [...document.querySelectorAll('audio')].find((x) => x.src);
  return !!el && !el.paused;
});
check('a ping does not touch the music', stillPlaying);

// ── the library ───────────────────────────────────────────────────────────
const soundName = `Quack ${run}`;
let snd = null;
{
  await a.page.locator('form[aria-label="Add to the library"] input[type=file]')
    .setInputFiles({ name: 'quack.wav', mimeType: 'audio/wav', buffer: makeWav(4) });
  await a.page.getByPlaceholder('Name (optional)').fill(soundName);
  const up = a.page.waitForResponse((r) => r.url().endsWith('/api/admin/pranks/sounds') && r.request().method() === 'POST');
  await a.page.getByRole('button', { name: 'Upload' }).click();
  const upRes = await up;
  snd = (await upRes.json()).sound;
  check('the admin uploads a short sound from the page (201)', upRes.status() === 201 && snd?.kind === 'sound'
    && Math.abs((snd?.durationSec ?? 0) - 4) < 0.5, `${upRes.status()} ${JSON.stringify(snd)}`);
  const listed = await a.page.getByRole('list', { name: 'Library' }).getByText(soundName).first()
    .waitFor({ timeout: 8_000 }).then(() => true, () => false);
  check('it shows in the library by name', listed);
}

async function uploadAs(who, bytes, fields, filename, type) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type }), filename);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return fetch(`${APP_URL}/api/admin/pranks/sounds`, { method: 'POST', body: form, headers: { cookie: `pb_auth=${who.cookie}` } });
}
{
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300)]);
  const fake = await uploadAs(boss, png, { kind: 'sound' }, 'quack.mp3', 'audio/mpeg');
  check('a png renamed to mp3 is refused (415)', fake.status === 415, String(fake.status));
  const long = await uploadAs(boss, makeWav(31), { kind: 'sound' }, 'long.wav', 'audio/wav');
  const longBody = await long.json();
  check('a 31 s sound is refused in words', long.status === 400 && longBody.error === 'Sounds are 30 seconds at most; trim it and try again', longBody.error);
  const member = await uploadAs(outsider, makeWav(1), { kind: 'sound' }, 'x.wav', 'audio/wav');
  check('a member cannot upload to the library (403)', member.status === 403);
  const list = await app(outsider, '/api/admin/pranks/sounds');
  check('a member cannot list the library (403)', list.status === 403);
  const pbList = await fetch(`${APP_URL}/pb/api/collections/prank_sounds/records`, { headers: { Authorization: target.token } }).then((r) => r.json());
  check('nor read it through /pb', !(pbList.totalItems > 0), JSON.stringify(pbList).slice(0, 120));
}

const mediaPath = `/api/pranks/media/${snd?.id}`;
const mediaStatus = (who, headers = {}) => fetch(`${APP_URL}${mediaPath}`, { headers: { cookie: `pb_auth=${who.cookie}`, ...headers } })
  .then(async (r) => { await r.arrayBuffer().catch(() => null); return r.status; });
{
  check('the admin can fetch the media (200)', (await mediaStatus(boss)) === 200);
  check('with Range (206)', (await mediaStatus(boss, { range: 'bytes=0-99' })) === 206);
  check('a non-admin cannot fetch the media URL (403)', (await mediaStatus(outsider)) === 403);
  check('nor can the target before any prank carries it (403)', (await mediaStatus(target)) === 403);
  const anon = await fetch(`${APP_URL}${mediaPath}`, { redirect: 'manual' });
  check('nor anyone signed out', ![200, 206].includes(anon.status) && !(anon.headers.get('content-type') ?? '').startsWith('audio/'),
    `${anon.status} ${anon.headers.get('content-type')}`);
}

// ── a sound, ducking the music ────────────────────────────────────────────
{
  // Sample the target's audio elements every 100 ms from here on.
  await t.page.evaluate(() => {
    window.__mix = [];
    const tick = () => {
      const all = [...document.querySelectorAll('audio')];
      const fx = all.find((x) => x.src.includes('/api/pranks/media/'));
      const music = all.find((x) => x.src && !x.src.includes('/api/pranks/media/'));
      window.__mix.push({
        at: Date.now(),
        fx: fx ? { src: fx.src, time: fx.currentTime, volume: fx.volume } : null,
        musicVolume: music ? music.volume : null,
        musicPaused: music ? music.paused : null,
        musicTime: music ? music.currentTime : null,
      });
    };
    window.__mixTimer = setInterval(tick, 100);
  });
  await t.page.waitForTimeout(400);
  const before = await t.page.evaluate(() => window.__mix.at(-1).musicVolume);

  // Pick the target: the composer fills in with what they play and the
  // hourly limit line.
  await a.page.getByRole('button', { name: `Pick ${targetName}` }).click();
  const composer = a.page.getByTestId('prank-composer');
  check('the composer fills in for the picked person', await composer.getByText(`Send a sound to ${targetName}`).isVisible()
    && ((await composer.textContent()) ?? '').includes('Playing'));
  const limitBefore = (await a.page.getByTestId('prank-limit').textContent()) ?? '';
  check('it shows the limit line', /^\d+ of 20 this hour for /.test(limitBefore), limitBefore);
  await composer.getByRole('radio', { name: new RegExp(soundName) }).click();
  const sentRes = a.page.waitForResponse((r) => r.url().endsWith('/api/admin/pranks') && r.request().method() === 'POST');
  await composer.getByRole('button', { name: 'Send', exact: true }).click();
  const soundRes = await sentRes;
  const soundSentAt = Date.now();
  const soundPrank = (await soundRes.json()).prank;
  check('Sound creates a prank (201)', soundRes.status() === 201, String(soundRes.status()));

  let sawDelivered = false;
  let liveMedia = null;
  let srow = null;
  while (Date.now() - soundSentAt < 20_000) {
    srow = await pbRow(soundPrank.id);
    if (srow.status === 'delivered' && !sawDelivered) {
      sawDelivered = true;
      liveMedia = await mediaStatus(target);
    }
    if (srow.status !== 'pending' && srow.status !== 'delivered') break;
    await sleep(150);
  }
  check('the target acknowledges the sound once it is heard, then says done', sawDelivered && srow?.status === 'done'
    && srow?.engine === 'web', `${srow?.status} ${srow?.engine} ${srow?.reason}`);
  check('it ran for the sound\'s length', srow?.played_sec >= 3 && srow?.played_sec <= 5, String(srow?.played_sec));
  check('the target may fetch the media while the prank is live (200)', liveMedia === 200, String(liveMedia));
  check('and not once it is over (403)', (await mediaStatus(target)) === 403);

  await t.page.waitForTimeout(600);
  const mix = await t.page.evaluate(() => { clearInterval(window.__mixTimer); return window.__mix; });
  const during = mix.filter((m) => m.fx);
  const firstFx = during[0];
  const maxTime = Math.max(0, ...during.map((m) => m.fx.time));
  check('the target page plays it on a second audio element', !!firstFx && firstFx.fx.src === `${APP_URL}${mediaPath}` && maxTime > 2,
    `${firstFx?.fx.src} up to ${maxTime.toFixed(2)} s`);
  check('within a few seconds of Send', !!firstFx && firstFx.at - soundSentAt < 5_000, `${firstFx ? firstFx.at - soundSentAt : '-'} ms`);
  const ducked = Math.min(...during.slice(3).map((m) => m.musicVolume ?? 1));
  check('the music drops while it plays', ducked < before * 0.5, `${before.toFixed(3)} -> ${ducked.toFixed(3)}`);
  const last = mix.at(-1);
  check('and comes back after', !last.fx && Math.abs((last.musicVolume ?? 0) - before) < 0.005, `${last.musicVolume}`);
  check('the sound is never louder than the music was', during.every((m) => m.fx.volume <= before + 1e-6),
    `${Math.max(...during.map((m) => m.fx.volume))} vs ${before}`);
  check('the music keeps playing throughout', mix.every((m) => m.musicPaused === false));
  // The song's own clock is untouched: no pause, no seek, no jump. It only
  // ever moves forward, and over the whole prank by about as much real time
  // as passed, so the progress bar never shows that anything happened.
  const times = mix.map((m) => m.musicTime).filter((x) => typeof x === 'number');
  const forwardOnly = times.every((x, i) => i === 0 || x >= times[i - 1] - 0.05);
  const wall = (mix.at(-1).at - mix[0].at) / 1000;
  const moved = times.at(-1) - times[0];
  check('the song keeps its own time: only forward, at normal speed', forwardOnly && Math.abs(moved - wall) < 1.5,
    `song moved ${moved.toFixed(1)} s in ${wall.toFixed(1)} s, forward only: ${forwardOnly}`);

  const doneLine = await a.page.getByText(`played a sound for ${targetName}: done after`).first()
    .waitFor({ timeout: 8_000 }).then(() => true, () => false);
  check('the admin log says done, in words', doneLine);

  const again = await app(boss, '/api/admin/pranks', { method: 'POST', body: JSON.stringify({ targetId: target.id, kind: 'sound', soundId: snd.id }) });
  const againBody = await again.json();
  check('a second sound within 15 s is refused in words (429)', again.status === 429 && /^Sounds need 15 s between them/.test(againBody.error), againBody.error);

  const text = (await t.page.textContent('body')) ?? '';
  const said = /.{0,30}(pranked|from an admin|Pranks on you|Quack).{0,30}/i.exec(text)?.[0];
  check('nothing on the target page mentions the sound', !said, said);
  check('still no toast on the target side', (await t.page.locator('[data-sonner-toast]').count()) === 0);
  check('still nothing in the target console about pranks', !t.consoleLines.some((l) => /prank/i.test(l)),
    t.consoleLines.filter((l) => /prank/i.test(l)).join(' | '));

  // Sounds only while music plays: pause, wait out the gap, send again.
  await t.page.evaluate(() => [...document.querySelectorAll('audio')].find((x) => x.src)?.pause());
  const gap = soundSentAt + 16_000 - Date.now();
  if (gap > 0) await sleep(gap);
  const paused = await app(boss, '/api/admin/pranks', { method: 'POST', body: JSON.stringify({ targetId: target.id, kind: 'sound', soundId: snd.id }) });
  const pausedPrank = (await paused.json()).prank;
  // A device where nothing plays neither plays the sound nor answers for it
  // (bughunt N6: an idle tab used to mark it skipped and swallow it for the
  // device that was playing). It stays pending, then expires unheard.
  await sleep(6_000);
  let prow = await pbRow(pausedPrank.id);
  check('a sound for someone whose music is paused is left waiting, not played', prow?.status === 'pending',
    `${prow?.status} ${prow?.reason}`);
  const pausedLog = async () => (await app(boss, `/api/admin/pranks?target=${target.id}`).then((r) => r.json()))
    .pranks?.find((p) => p.id === pausedPrank.id);
  const waitingLine = (await pausedLog())?.line ?? '';
  check('and the log says it is waiting, in words', waitingLine.endsWith('waiting for their app'), waitingLine);
  // Wait out its 45 s so it cannot be picked up when the music comes back on
  // below, where it would take the place of the repeat's first play.
  let pausedEntry = null;
  const pausedAt = Date.now();
  while (Date.now() - pausedAt < 55_000) {
    pausedEntry = await pausedLog();
    if (pausedEntry?.status === 'expired') break;
    await sleep(1000);
  }
  check('nobody playing it, it expires and the log says so', pausedEntry?.status === 'expired'
    && (pausedEntry?.line ?? '').endsWith('not delivered: offline, paused, or app too old'), pausedEntry?.line);
  const noFx = await t.page.evaluate(() => ![...document.querySelectorAll('audio')].some((x) => x.src.includes('/api/pranks/media/')));
  check('nothing played on the paused page', noFx);
}

// ── repeats ───────────────────────────────────────────────────────────────
// The app runs with PRANK_TICK_INTERVAL_MS=1000 (the tick every second
// instead of every 5 s) so a fire lands within a second of being due; the
// 60 s minimum between plays is the real one.
const pbList = (collection, filter) => fetch(`${PB_URL}/api/collections/${collection}/records?perPage=200&filter=${encodeURIComponent(filter)}`,
  { headers: pbHeaders }).then((r) => r.json()).then((b) => b.items ?? []);
const hourCount = async () => (await app(boss, '/api/admin/pranks/people').then((r) => r.json()))
  .people?.find((p) => p.id === target.id)?.hourCount;
const hhmm = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
async function startRepeat() {
  const composer = a.page.getByTestId('prank-composer');
  const box = composer.getByRole('checkbox', { name: 'Repeat until a stop time' });
  if (!(await box.isChecked())) await box.check();
  await composer.getByRole('spinbutton', { name: 'Every how many minutes' }).fill('1');
  await composer.getByLabel('Stop time', { exact: true }).fill(hhmm(Date.now() + 10 * 60_000));
  const res = a.page.waitForResponse((r) => r.url().endsWith('/api/admin/pranks/schedules') && r.request().method() === 'POST');
  await composer.getByRole('button', { name: 'Repeat every minute' }).click();
  const r = await res;
  return { status: r.status(), schedule: (await r.json()).schedule };
}
{
  // Still paused from above: a repeat that finds nothing playing logs a skip
  // and does not count against the hour.
  const countBefore = await hourCount();
  const first = await startRepeat();
  check('the page starts a repeat every minute (201)', first.status === 201 && first.schedule?.intervalSec === 60,
    `${first.status} ${first.schedule?.line}`);
  const banner = await a.page.getByRole('list', { name: 'Repeats running' }).getByText(first.schedule.line).first()
    .waitFor({ timeout: 8_000 }).then(() => true, () => false);
  check('it shows as running, in words', banner);
  let skipped = [];
  for (let i = 0; i < 40 && skipped.length === 0; i++) {
    skipped = await pbList('pranks', `schedule = "${first.schedule.id}"`);
    if (skipped.length === 0) await sleep(250);
  }
  check('a fire while their music is paused is skipped as not playing', skipped.length === 1
    && skipped[0].status === 'skipped' && skipped[0].reason === 'not-playing', JSON.stringify(skipped.map((r) => [r.status, r.reason])));
  check('and does not count against their hour', (await hourCount()) === countBefore, `${countBefore} -> ${await hourCount()}`);
  const skipLine = await a.page.getByText('nothing was playing (repeat)').first().waitFor({ timeout: 8_000 }).then(() => true, () => false);
  check('the log shows the skipped repeat, in words', skipLine);
  await a.page.getByRole('button', { name: `Stop ${first.schedule.line}` }).first().click();
  let stopped = null;
  for (let i = 0; i < 20; i++) {
    stopped = await fetch(`${PB_URL}/api/collections/prank_schedules/records/${first.schedule.id}`, { headers: pbHeaders }).then((r) => r.json());
    if (stopped.active === false) break;
    await sleep(250);
  }
  check('Stop on a repeat ends it', stopped?.active === false);

  // Music back on, then a repeat that lands twice.
  await t.page.evaluate(() => [...document.querySelectorAll('audio')].find((x) => x.src && !x.src.includes('/api/pranks/media/'))?.play());
  let line = '';
  for (let i = 0; i < 20 && !line.startsWith('Playing'); i++) {
    line = (await app(boss, '/api/admin/pranks/people').then((r) => r.json())).people?.find((p) => p.id === target.id)?.line ?? '';
    if (!line.startsWith('Playing')) await sleep(500);
  }
  check('the target is playing again', line.startsWith('Playing'), line);

  await t.page.evaluate(() => {
    window.__mix = [];
    window.__mixTimer = setInterval(() => {
      const all = [...document.querySelectorAll('audio')];
      const fx = all.find((x) => x.src.includes('/api/pranks/media/'));
      const music = all.find((x) => x.src && !x.src.includes('/api/pranks/media/'));
      window.__mix.push({ at: Date.now(), fx: !!fx, musicVolume: music ? music.volume : null });
    }, 100);
  });
  await t.page.waitForTimeout(400);
  const level = await t.page.evaluate(() => window.__mix.at(-1).musicVolume);

  const second = await startRepeat();
  const startedAt = Date.now();
  check('a second repeat starts (201)', second.status === 201, String(second.status));
  let plays = [];
  while (Date.now() - startedAt < 100_000) {
    plays = await pbList('pranks', `schedule = "${second.schedule.id}"`);
    if (plays.filter((r) => r.status === 'done').length >= 2) break;
    await sleep(1000);
  }
  const done = plays.filter((r) => r.status === 'done').sort((x, y) => x.created.localeCompare(y.created));
  check('two plays land from the repeat, both heard to the end', done.length === 2 && done.every((r) => r.played_sec >= 3),
    JSON.stringify(plays.map((r) => [r.status, r.reason, r.played_sec])));
  const apart = done.length === 2 ? (Date.parse(done[1].created.replace(' ', 'T')) - Date.parse(done[0].created.replace(' ', 'T'))) / 1000 : 0;
  check('a minute apart', apart >= 58 && apart <= 70, `${apart.toFixed(1)} s`);

  await t.page.waitForTimeout(600);
  const mix = await t.page.evaluate(() => { clearInterval(window.__mixTimer); return window.__mix; });
  const runs = [];
  for (let i = 0; i < mix.length; i++) {
    if (mix[i].fx && !mix[i - 1]?.fx) runs.push({ from: i, to: i });
    if (mix[i].fx) runs.at(-1).to = i;
  }
  check('the target page played the sound twice', runs.length === 2, `${runs.length} runs`);
  const duckedEach = runs.every((r) => Math.min(...mix.slice(r.from + 3, r.to + 1).map((m) => m.musicVolume ?? 1)) < level * 0.5);
  check('the music went down under each play', duckedEach);
  check('and came back after', Math.abs((mix.at(-1).musicVolume ?? 0) - level) < 0.005 && !mix.at(-1).fx, `${mix.at(-1).musicVolume} vs ${level}`);
  const repeatDone = await a.page.getByText(`played a sound for ${targetName}: done after`).nth(2)
    .waitFor({ timeout: 8_000 }).then(() => true, () => false);
  check('the log lists the repeat plays as done', repeatDone);

  // Stop everything: the repeat ends and even a due fire no longer plays.
  const stopRes = a.page.waitForResponse((r) => r.url().endsWith('/api/admin/pranks/stop-all'));
  await a.page.getByRole('button', { name: 'Stop everything' }).click();
  const stopBody = await (await stopRes).json();
  const after = await fetch(`${PB_URL}/api/collections/prank_schedules/records/${second.schedule.id}`, { headers: pbHeaders }).then((r) => r.json());
  check('Stop everything ends the repeat', stopBody.stopped >= 1 && after.active === false, JSON.stringify(stopBody));
  const gone = await a.page.getByRole('list', { name: 'Repeats running' }).waitFor({ state: 'detached', timeout: 8_000 })
    .then(() => true, () => false);
  check('and the page shows nothing running', gone);
  await fetch(`${PB_URL}/api/collections/prank_schedules/records/${second.schedule.id}`, { method: 'PATCH', headers: pbHeaders,
    body: JSON.stringify({ next_fire_at: new Date(Date.now() - 1000).toISOString().replace('T', ' ') }) });
  await sleep(3000);
  const later = await pbList('pranks', `schedule = "${second.schedule.id}"`);
  check('a stopped repeat never fires again, even when due', later.length === plays.length, `${plays.length} -> ${later.length}`);
}

// ── the off switch, from the page ─────────────────────────────────────────
{
  const sw = a.page.getByRole('switch', { name: 'Pranks on or off' });
  const offRes = a.page.waitForResponse((r) => r.url().endsWith('/api/admin/pranks/settings') && r.request().method() === 'PATCH');
  await sw.click();
  await offRes;
  const isOff = await a.page.getByText('Nobody can be pranked right now.').waitFor({ timeout: 8_000 }).then(() => true, () => false);
  check('the page switches pranks off', isOff && (await sw.getAttribute('aria-checked')) === 'false');
  const composer = a.page.getByTestId('prank-composer');
  const box = composer.getByRole('checkbox', { name: 'Repeat until a stop time' });
  if (await box.isChecked()) await box.uncheck().catch(() => {});
  check('while off the page cannot send', await composer.getByRole('button', { name: /^(Send|Repeat .*)$/ }).isDisabled());
  const direct = await app(boss, '/api/admin/pranks', { method: 'POST', body: JSON.stringify({ targetId: target.id, kind: 'sound', soundId: snd.id }) });
  check('and the route refuses a sound (409)', direct.status === 409);
  const rep = await app(boss, '/api/admin/pranks/schedules', { method: 'POST', body: JSON.stringify({
    targetId: target.id, soundId: snd.id, intervalSec: 60, endsAt: new Date(Date.now() + 10 * 60_000).toISOString() }) });
  check('and a repeat (409)', rep.status === 409);
  const onRes = a.page.waitForResponse((r) => r.url().endsWith('/api/admin/pranks/settings') && r.request().method() === 'PATCH');
  await sw.click();
  await onRes;
  const isOn = await a.page.getByText('Every admin can send a sound to a friend.').waitFor({ timeout: 8_000 }).then(() => true, () => false);
  check('and back on', isOn);
}

// ── delete from the library ───────────────────────────────────────────────
{
  const del = await app(boss, `/api/admin/pranks/sounds/${snd.id}`, { method: 'DELETE' });
  check('the admin deletes the sound (200)', del.status === 200);
  check('and its media is gone (404)', (await mediaStatus(boss)) === 404);
}

// ── rules at the /pb boundary ─────────────────────────────────────────────
{
  const list = await fetch(`${APP_URL}/pb/api/collections/pranks/records`, { headers: { Authorization: target.token } }).then((r) => r.json());
  check('the target cannot list its acknowledged pranks through /pb', list.totalItems === 0, JSON.stringify(list).slice(0, 120));
  const write = await fetch(`${APP_URL}/pb/api/collections/pranks/records`, { method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: target.token },
    body: JSON.stringify({ target: outsider.id, kind: 'ping', status: 'pending', expires_at: '2099-01-01 00:00:00.000Z' }) });
  check('nobody writes pranks from the client', write.status >= 400, String(write.status));
  const settings = await fetch(`${APP_URL}/pb/api/collections/app_settings/records`, { headers: { Authorization: target.token } }).then((r) => r.json());
  check('a member cannot read the switch through /pb', settings.totalItems === 0);
}

// ── guard rails ───────────────────────────────────────────────────────────
{
  const res = await app(outsider, '/api/admin/pranks', { method: 'POST', body: JSON.stringify({ targetId: target.id, kind: 'ping' }) });
  check('a member cannot send a prank (403)', res.status === 403);
  const people = await app(outsider, '/api/admin/pranks/people');
  check('a member cannot see who plays what (403)', people.status === 403);
}
{
  // A second admin who has already sent 60 this hour.
  const busy = await member('busy', { admin: true });
  const expires = new Date(Date.now() + 45_000).toISOString().replace('T', ' ');
  await Promise.all(Array.from({ length: 60 }, () => fetch(`${PB_URL}/api/collections/pranks/records`, { method: 'POST', headers: pbHeaders,
    body: JSON.stringify({ target: outsider.id, issued_by: busy.id, kind: 'ping', status: 'done', params: {}, expires_at: expires }) })));
  const res = await app(busy, '/api/admin/pranks', { method: 'POST', body: JSON.stringify({ targetId: target.id, kind: 'ping' }) });
  const body = await res.json();
  check('the hourly cap answers 429 in words', res.status === 429 && /^You have sent 60 pranks this hour/.test(body.error) && !!res.headers.get('retry-after'), `${res.status} ${body.error}`);
}

// ── expiry ────────────────────────────────────────────────────────────────
{
  const wait = offlineAt + 46_000 - Date.now();
  if (wait > 0) await sleep(wait);
  const log = await app(boss, `/api/admin/pranks?target=${offline.id}`).then((r) => r.json());
  const entry = log.pranks?.find((p) => p.id === offlinePrank?.id);
  check('an unanswered ping reads as expired after 45 s', entry?.status === 'expired', entry?.line);
  check('and the log says so in words', /not delivered: offline, paused, or app too old$/.test(entry?.line ?? ''));
  const stored = await pbRow(offlinePrank.id);
  check('the expiry is written back to the row', stored.status === 'expired');
}

await browser.close();
const failed = checks.filter(([, p]) => !p);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
