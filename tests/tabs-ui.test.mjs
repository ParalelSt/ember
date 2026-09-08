/** UI check for in-app tabs: add a Guitar Pro file from the player, then
 *  render it with AlphaTab without leaving Ember.
 *
 *      npm i -D playwright-core
 *      node tests/tabs-ui.test.mjs        # or: npm run test:tabs-ui
 *
 *  Same sandbox as tests/tabs.test.mjs (PB 8091, app 3010, MUSIC_DIR set).
 *  Set CHROME_PATH to pick a browser. */
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
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3010';
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

async function adminToken() {
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const res = await fetch(`${PB_URL}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: 'admin@ember.com', password: 'egKa5WNMx3QpuG7' }) });
    if (res.ok) return (await res.json()).token;
  }
  throw new Error('could not authenticate as PB admin');
}

const token = await adminToken();
const email = `tabsui-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
await fetch(`${PB_URL}/api/collections/users/records`, { method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: token },
  body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name: 'Tabs Tester', verified: true }) });
const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PASSWORD }) })
  .then((r) => r.json());
const cookie = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));

/** A real score, so this proves AlphaTab actually renders rather than just
 *  that the dialog opens. MusicXML because it is the open format we can keep
 *  in the repo — Guitar Pro files are binary and someone else's export. Point
 *  TAB_SAMPLE at a .gp5 to run the same flow against a real Guitar Pro file. */
const SAMPLE = process.env.TAB_SAMPLE ?? path.join(process.cwd(), 'tests/fixtures/sample.musicxml');
const tmp = path.join(os.tmpdir(), `ui-tab-${Date.now()}${path.extname(SAMPLE)}`);
fs.writeFileSync(tmp, fs.readFileSync(SAMPLE));

/** A song has to be playing for the player bar (and its tabs button) to
 *  exist. Upload a tiny wav through the API — no network, no yt-dlp. */
// Long enough that it cannot finish and auto-advance mid-test: the dialog
// lists tabs for whatever is playing, so a track change would look like a
// missing tab.
function makeWav(seconds = 180, sampleRate = 8000) {
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

const songTitle = `Tab Test Song ${Date.now()}`;
{
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(makeWav())], { type: 'audio/wav' }), 'song.wav');
  form.append('title', songTitle);
  form.append('artist', 'Tab Tester');
  const res = await fetch(`${APP_URL}/api/uploads`, { method: 'POST', body: form,
    headers: { cookie: `pb_auth=${cookie}` } });
  if (!res.ok) throw new Error(`could not seed a playable song: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
await ctx.addCookies([{ name: 'pb_auth', value: cookie, domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
page.on('response', (r) => {
  if (process.env.DEBUG_TABS && r.url().includes('/api/tabs/files')) console.log('[net]', r.request().method(), r.status(), r.url());
});
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// Start the seeded song so the player bar (and its tabs button) exists.
await page.goto(`${APP_URL}/library`, { waitUntil: 'networkidle' });
await page.getByRole('tab', { name: /uploads/i }).click();
await page.getByText(songTitle).first().click({ clickCount: 2 });
await page.waitForTimeout(2500);

const tabsButton = page.getByRole('button', { name: 'Guitar tabs' });
const hasPlayer = await tabsButton.count();
if (!hasPlayer) {
  // No track in the player: drive the dialog through the tab library instead,
  // which is the same component with `track` null.
  check('player bar present', false, 'no track playing — start one to run the full flow');
} else {
  await tabsButton.first().click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 10_000 });
  check('the tabs dialog opens', true);

  await dialog.locator('input[type="file"]').setInputFiles(tmp);
  await page.waitForTimeout(4000);
  if (process.env.DEBUG_TABS) console.log('[dialog]', await dialog.innerText());
  await page.getByRole('button', { name: /open/i }).first().waitFor({ timeout: 20_000 });
  check('the uploaded tab appears in the dialog', true);

  await page.getByRole('button', { name: /open/i }).first().click();
  await page.getByRole('button', { name: /back/i }).waitFor({ timeout: 20_000 });
  check('clicking it opens the viewer', true);

  await page.waitForTimeout(8000);
  // Measure alphaTab's OWN drawing surface, not "is there an <svg>". The
  // dialog is full of 24x24 icons, so counting <svg> nodes reported success
  // for weeks while the score rendered 848x0 and nothing was visible.
  const surface = await page.evaluate(() => {
    const el = document.querySelector('[role="dialog"] .at-surface');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  check('AlphaTab actually drew the score', Boolean(surface && surface.w > 100 && surface.h > 100),
    surface ? `surface ${surface.w}x${surface.h}` : 'no .at-surface at all');
  const stuck = /Rendering the tab/i.test(await dialog.innerText());
  check('the viewer is not left on the loading message', !stuck);

  // ── phase 4: the cursor follows the song ────────────────────────────────
  const cursors = await dialog.locator('.at-cursor-beat, .at-cursor-bar').count();
  check('a playback cursor is drawn', cursors > 0, `${cursors} cursor element(s)`);

  /** Where alphaTab has put the beat cursor, in page pixels. */
  const cursorX = () => page.evaluate(() => {
    const el = document.querySelector('.at-cursor-beat');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return Math.round(r.left + window.scrollX);
  });

  const first = await cursorX();
  await page.waitForTimeout(6000);
  const later = await cursorX();
  check('the cursor moves as the song plays',
    first !== null && later !== null && later !== first, `${first}px -> ${later}px`);

  // The offset control must actually shift the cursor, since that is the only
  // remedy for a tab that transcribes a different take.
  const slider = dialog.locator('input[aria-label="Tab timing offset in seconds"]');
  check('the sync offset control is present', (await slider.count()) > 0);
  const beforeNudge = await cursorX();
  await slider.evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '6');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(2500);
  const afterNudge = await cursorX();
  check('nudging the offset shifts the cursor',
    beforeNudge !== null && afterNudge !== null && afterNudge !== beforeNudge,
    `${beforeNudge}px -> ${afterNudge}px`);
}

const noisy = consoleErrors.filter((e) => !/favicon|404/.test(e));
check('no unexpected console errors', noisy.length === 0, noisy.slice(0, 2).join(' | '));

await browser.close();
fs.rmSync(tmp, { force: true });

const failed = checks.filter(([, p]) => !p);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map(([n]) => n).join(', '));
process.exit(failed.length ? 1 : 0);
