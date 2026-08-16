/** UI check for custom uploads: pick a file in the Library, upload it, and
 *  confirm it appears in the Uploads tab and plays.
 *
 *      npm i -D playwright-core
 *      node tests/uploads-ui.test.mjs      # or: npm run test:uploads-ui
 *
 *  Same sandbox as tests/uploads.test.mjs. Set CHROME_PATH to pick a browser. */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('This test needs playwright-core:\n\n  npm i -D playwright-core\n');
  process.exit(2);
}

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8091';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3005';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL ?? 'admin@ember.com';
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD ?? 'egKa5WNMx3QpuG7';
const PASSWORD = 'BugTest2026!';

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = path.join(process.env.HOME ?? '', 'Library/Caches/ms-playwright');
  if (!fs.existsSync(root)) throw new Error('no Playwright browser cache — set CHROME_PATH');
  for (const d of fs.readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const found = execSync(
      `find "${path.join(root, d)}" -maxdepth 6 -type f \\( -name "Google Chrome for Testing" -o -name "Chromium" \\) 2>/dev/null | head -1`,
      { encoding: 'utf8' },
    ).trim();
    if (found) return found;
  }
  throw new Error('no Chromium binary found — set CHROME_PATH');
}

function makeWav(seconds = 1, sampleRate = 8000) {
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
const email = `uitest-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
const created = await fetch(`${PB_URL}/api/collections/users/records`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: token },
  body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name: 'UI Tester', verified: true }),
});
if (!created.ok) throw new Error(`could not create test user: ${created.status}`);
const userId = (await created.json()).id;
const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identity: email, password: PASSWORD }),
}).then((r) => r.json());
const cookie = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));

// "Artist - Title.wav" exercises the filename pre-fill.
const songTitle = `UI Song ${Date.now()}`;
const tmp = path.join(os.tmpdir(), `UI Artist - ${songTitle}.wav`);
fs.writeFileSync(tmp, makeWav(2));

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
await ctx.addCookies([{ name: 'pb_auth', value: cookie, domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

await page.goto(`${APP_URL}/library`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /^upload$/i }).first().click();
await page.locator('input[type="file"]').setInputFiles(tmp);

// Metadata pre-fill reads the file in the browser, so give it a moment.
await page.waitForTimeout(1500);
const titleValue = await page.locator('input[placeholder="Title"]').inputValue();
const artistValue = await page.locator('input[placeholder="Artist"]').inputValue();
check('title pre-filled from filename', titleValue === songTitle, titleValue);
check('artist pre-filled from filename', artistValue === 'UI Artist', artistValue);
const meta = await page.locator('[role="dialog"]').filter({ hasText: 'Upload a song' }).first().innerText();
check('duration read in the browser', /0:02/.test(meta), meta.split('\n').at(-2));

await page.getByRole('button', { name: /^upload$/i }).last().click();
await page.getByText(/Uploaded/i).first().waitFor({ timeout: 30_000 });
check('success toast shown', true);

await page.getByRole('tab', { name: /uploads/i }).click();
await page.getByText(songTitle).first().waitFor({ timeout: 15_000 });
check('song listed in the Uploads tab', true);

// Play it: the audio element should get a src on our uploads route and
// actually advance past zero.
await page.getByText(songTitle).first().dblclick();
await page.waitForTimeout(3000);
const audio = await page.evaluate(() => {
  const el = document.querySelector('audio');
  return el ? { src: el.src, time: el.currentTime, paused: el.paused, error: el.error?.code ?? null } : null;
});
check('player points at the uploads stream', !!audio?.src?.includes('/api/uploads/'), audio?.src ?? 'no audio element');
check('audio has no decode/network error', audio?.error === null, `error code ${audio?.error}`);
check('playback advances', (audio?.time ?? 0) > 0, `t=${audio?.time?.toFixed(2)}s paused=${audio?.paused}`);
check('no console errors', consoleErrors.length === 0, consoleErrors[0] ?? '');

const failed = checks.filter(([, p]) => !p);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);

await browser.close();
fs.unlinkSync(tmp);
await fetch(`${PB_URL}/api/collections/users/records/${userId}`, { method: 'DELETE', headers: { Authorization: token } }).catch(() => {});
process.exit(failed.length ? 1 : 0);
