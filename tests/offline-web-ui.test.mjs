/** Browser-storage playlist download, end to end (bughunt P09).
 *
 *      node tests/offline-web-ui.test.mjs
 *
 *  Seeds a user and a playlist holding two uploaded songs plus one song whose
 *  file is gone (so nothing here depends on YouTube), presses Download, goes
 *  offline, and presses play. Checks that the dead song is skipped and
 *  reported instead of failing the whole playlist, and that the song plays
 *  from the downloaded copy with the network off.
 *
 *  Needs a built app and a PocketBase (defaults: app 3053, PB 8086). Set
 *  CHROME_PATH to pick a browser. */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.error('needs playwright-core: npm i -D playwright-core'); process.exit(2); }

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8086';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3053';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL ?? 'admin@ember.com';
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD ?? 'egKa5WNMx3QpuG7';
const PASSWORD = 'BugTest2026!';

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = path.join(process.env.HOME ?? '', 'Library/Caches/ms-playwright');
  if (!fs.existsSync(root)) throw new Error('no Playwright browser cache: set CHROME_PATH');
  for (const d of fs.readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const found = execSync(
      `find "${path.join(root, d)}" -maxdepth 6 -type f \\( -name "Google Chrome for Testing" -o -name "Chromium" \\) 2>/dev/null | head -1`,
      { encoding: 'utf8' },
    ).trim();
    if (found) return found;
  }
  throw new Error('no Chromium binary found: set CHROME_PATH');
}

/** A few seconds of 440 Hz tone: long enough to be caught mid-play. */
function makeWav(seconds = 6, sampleRate = 8000) {
  const samples = seconds * sampleRate;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    data.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
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

const token = await adminToken();
const email = `offweb-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
const created = await fetch(`${PB_URL}/api/collections/users/records`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: token },
  body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name: 'Offline Tester', verified: true }),
});
if (!created.ok) throw new Error(`could not create test user: ${created.status} ${await created.text()}`);
const userId = (await created.json()).id;
const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identity: email, password: PASSWORD }),
}).then((r) => r.json());
const cookie = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));
const appFetch = (p, init = {}) =>
  fetch(`${APP_URL}${p}`, { ...init, headers: { ...(init.headers ?? {}), cookie: `pb_auth=${cookie}` } });

// Seed: two uploads, a playlist, and a third track whose upload does not exist.
async function upload(title) {
  const form = new FormData();
  form.append('file', new Blob([makeWav()], { type: 'audio/wav' }), `${title}.wav`);
  form.append('title', title);
  form.append('artist', 'Offline Artist');
  form.append('durationSec', '6');
  const res = await appFetch('/api/uploads', { method: 'POST', body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
}
await upload('Offline One');
await upload('Offline Two');
const { tracks: uploads } = await appFetch('/api/uploads').then((r) => r.json());
const { playlist: pl } = await appFetch('/api/playlists', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Offline Mix' }),
}).then((r) => r.json());
const ghost = { ...uploads[0], id: 'upload:ghost00000000', sourceId: 'ghost00000000', title: 'Ghost Song', streamUrl: '/api/uploads/ghost00000000/stream' };
for (const track of [uploads.find((t) => t.title === 'Offline One'), ghost, uploads.find((t) => t.title === 'Offline Two')]) {
  const res = await appFetch(`/api/playlists/${pl.id}/tracks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ track }),
  });
  if (!res.ok) throw new Error(`add to playlist failed: ${res.status} ${await res.text()}`);
}

const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
await ctx.addCookies([{ name: 'pb_auth', value: cookie, domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

try {
  await page.goto(`${APP_URL}/playlist/${pl.id}`, { waitUntil: 'networkidle' });
  await page.getByText('Offline One').first().waitFor({ timeout: 15_000 });

  // The web button's tooltip says the copy lasts while the tab stays open
  // (bughunt O7); only Android's says "Save this collection...". Find it by name.
  await page.getByRole('button', { name: 'Download for offline' }).click();
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: /Offline Mix/ }).first();
  await toast.waitFor({ timeout: 30_000 });
  const toastText = (await toast.innerText()).replace(/\s+/g, ' ').trim();
  // SHOT=<file.png> saves the download message, for a before/after pair.
  if (process.env.SHOT) await toast.screenshot({ path: process.env.SHOT });
  check('download succeeds for a playlist of uploads', /^Downloaded "Offline Mix"/.test(toastText), toastText);
  check('the one dead track is skipped and reported', /1 of 3 couldn't be saved/.test(toastText), toastText);
  const removeBtn = await page.getByTitle(/Remove offline copy|Update offline copy/).count();
  check('the playlist shows as downloaded', removeBtn > 0);

  await ctx.setOffline(true);
  await page.getByText('Offline Two').first().dblclick();
  await page.waitForTimeout(3000);
  const audio = await page.evaluate(() => {
    const el = document.querySelector('audio');
    return el ? { src: el.src, time: el.currentTime, paused: el.paused, error: el.error?.code ?? null } : null;
  });
  check('offline, the player loads the downloaded copy', !!audio?.src?.startsWith('blob:'), audio?.src ?? 'no audio element');
  check('offline, the song actually plays', (audio?.time ?? 0) > 0.5 && audio?.error === null,
    `t=${audio?.time?.toFixed(2)}s paused=${audio?.paused} error=${audio?.error}`);
} catch (e) {
  check('test ran to the end', false, e.message.split('\n')[0]);
} finally {
  const failed = checks.filter(([, p]) => !p);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  await browser.close();
  await fetch(`${PB_URL}/api/collections/users/records/${userId}`, { method: 'DELETE', headers: { Authorization: token } }).catch(() => {});
  process.exit(failed.length ? 1 : 0);
}
