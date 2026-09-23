/** Admin pranks, delivery spine (plan Task 1): two browser contexts, an
 *  admin and a target.
 *
 *      npm i -D playwright-core
 *      PB_URL=http://127.0.0.1:8089 APP_URL=http://127.0.0.1:3051 node tests/pranks-ui.test.mjs
 *
 *  The target plays an uploaded song; the admin page shows what they play in
 *  words; a Ping from the admin page reaches the target and is acknowledged
 *  within a couple of seconds, with nothing shown on the target's side. The
 *  target cannot read acknowledged rows or write any. Members get 403, the
 *  switch gives 409, the hourly cap 429, and a ping to someone offline reads
 *  as expired after 45 s.
 *
 *  Needs a sandbox: PocketBase (PB_URL) with pb_hooks/ensure_pranks.pb.js
 *  loaded, and the app (APP_URL) built from this tree with MUSIC_DIR set.
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

// ── admin pings from the page ─────────────────────────────────────────────
const a = await context(boss);
await a.page.goto(`${APP_URL}/admin/pranks`, { waitUntil: 'networkidle' });
check('the admin page says it is temporary', await a.page.getByText(/Temporary page/).isVisible());
const targetName = `Target ${run}`;
const personLine = await a.page.locator('li', { hasText: targetName }).getByTestId('presence-line').textContent({ timeout: 10_000 }).catch(() => '');
check('the admin page shows the target playing', (personLine ?? '').startsWith('Playing'), personLine ?? '');

const created = a.page.waitForResponse((r) => r.url().endsWith('/api/admin/pranks') && r.request().method() === 'POST');
await a.page.getByRole('button', { name: `Ping ${targetName}` }).click();
const createdRes = await created;
const sentAt = Date.now();
const prank = (await createdRes.json()).prank;
check('Ping creates a prank (201)', createdRes.status() === 201);

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
