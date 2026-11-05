/** The owner's "second search page" (Android, 2026-11-03): after tapping
 *  the Search tab (which only opens the search sheet) and pressing Back on
 *  the full-screen player, the app came back on the /search PAGE. The
 *  stale-chunk reload (lib/chunkReload) had taken the tab's <a href="/search">
 *  for where the listener was headed.
 *
 *      node tests/back-to-search-ui.test.mjs     # or: npm run test:back-search-ui
 *
 *  Drives a real Chromium tab at phone size against the sandbox and checks:
 *    - Back closes the search sheet and stays on Home,
 *    - Back closes the full-screen player and stays on Home,
 *    - a chunk failure a few seconds after the Search tab reloads Home,
 *      never /search,
 *    - Guitar tabs from the player's More sheet still goes to the tab page
 *      and Back from there is Home again.
 *
 *  Creates its own user and upload, and deletes them again at the end.
 *  Needs the sandbox from tests/README.md and playwright-core. Set
 *  CHROME_PATH to pick a browser. */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.error('needs playwright-core: npm i -D playwright-core'); process.exit(2); }

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8088';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3050';
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

async function adminToken() {
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const r = await fetch(`${PB_URL}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: 'admin@ember.com', password: 'egKa5WNMx3QpuG7' }) });
    if (r.ok) return (await r.json()).token;
  }
  throw new Error('could not authenticate as PB admin');
}

/** A few seconds of a 440Hz tone, so the seeded track is real audio. */
function wav(seconds = 30, rate = 8000) {
  const n = seconds * rate;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const token = await adminToken();
const email = `backsearch-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
const created = await fetch(`${PB_URL}/api/collections/users/records`, { method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: token },
  body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name: 'Back Tester', verified: true }) });
if (!created.ok) throw new Error(`could not create test user: ${created.status}`);
const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PASSWORD }) })
  .then((r) => r.json());
const cookie = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));

const TITLE = `Back Test ${Date.now().toString(36).slice(-4)}`;
const form = new FormData();
form.append('file', new Blob([new Uint8Array(wav())], { type: 'audio/wav' }), 'a.wav');
form.append('title', TITLE);
form.append('artist', 'Back Tester');
const seeded = await fetch(`${APP_URL}/api/uploads`, { method: 'POST', body: form, headers: { cookie: `pb_auth=${cookie}` } });
if (!seeded.ok) throw new Error(`seed failed ${seeded.status}: ${(await seeded.text()).slice(0, 200)}`);
const uploadId = (await seeded.json()).track.sourceId;

async function cleanup() {
  const r = await fetch(`${APP_URL}/api/uploads/${uploadId}`, { method: 'DELETE', headers: { cookie: `pb_auth=${cookie}` } });
  if (!r.ok) console.log(`cleanup: upload not deleted (${r.status})`);
  const u = await fetch(`${PB_URL}/api/collections/users/records/${auth.record.id}`, { method: 'DELETE', headers: { Authorization: token } });
  console.log(u.ok ? 'cleanup: test user and upload removed' : `cleanup: user not deleted (${u.status})`);
}

const checks = [];
const check = (name, pass, detail = '') => { checks.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  : ${detail}` : ''}`); };

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addCookies([{ name: 'pb_auth', value: cookie, domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();

  const state = () => page.evaluate(() => ({
    path: location.pathname,
    h1: document.querySelector('main h1')?.textContent ?? null,
    sheet: (() => {
      const close = document.querySelector('[aria-label="Close search"]');
      return !!close && getComputedStyle(close).visibility === 'visible';
    })(),
    player: document.querySelector('[data-testid="now-playing"]')?.getAttribute('aria-hidden') === 'false',
  }));
  const tab = (label) => page.locator('[data-testid="mobile-nav"]').getByText(label, { exact: true }).click();
  // The phone's Back: the Android app calls WebView.goBack(), the same
  // traversal as history.back().
  const back = async () => { await page.evaluate(() => history.back()); await page.waitForTimeout(1200); };
  const openPlayer = async () => { await page.getByLabel('Open player').click(); await page.waitForTimeout(800); };
  const onHome = (s) => s.path === '/' && s.h1 === 'Home';

  // Play the upload, then go Home: the page the overlays open over.
  await page.goto(`${APP_URL}/library/uploads`, { waitUntil: 'networkidle' });
  const row = page.locator('[data-testid="track-row"]').filter({ hasText: TITLE }).first();
  await row.waitFor({ timeout: 20_000 });
  await row.getByLabel('Play', { exact: true }).first().click();
  await page.locator('[data-testid="phone-player-bar"]').waitFor({ timeout: 20_000 });
  await tab('Home');
  await page.waitForTimeout(1200);

  await tab('Search');
  await page.waitForTimeout(800);
  let s = await state();
  check('the Search tab opens the sheet over Home, no navigation', s.sheet && onHome(s), JSON.stringify(s));
  await back();
  s = await state();
  check('Back closes the sheet and stays on Home', !s.sheet && onHome(s), JSON.stringify(s));

  await openPlayer();
  s = await state();
  check('the full-screen player opens', s.player, JSON.stringify(s));
  await back();
  s = await state();
  check('Back closes the full-screen player and stays on Home', !s.player && onHome(s), JSON.stringify(s));

  // The owner's path: Search tab, Back, the player, then a chunk that fails
  // to load (a rebuilt server, a dropped request on mobile data), all inside
  // the reload's 10 s "where were they headed" window.
  await tab('Search');
  await page.waitForTimeout(600);
  await back();
  await openPlayer();
  await page.evaluate(() => {
    const e = new Error('Loading chunk 1234 failed.');
    e.name = 'ChunkLoadError';
    setTimeout(() => { throw e; });
  });
  await page.waitForTimeout(3000);
  s = await state();
  check('a chunk failure after the Search tab reloads Home, not the /search page', onHome(s), JSON.stringify(s));

  // Leaving the player for another page still lands there, and Back from
  // it is Home (the player's own entry is gone first).
  await page.locator('[data-testid="phone-player-bar"]').waitFor({ timeout: 20_000 });
  await openPlayer();
  await page.locator('[data-testid="now-playing"]').getByLabel('More').click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Guitar tabs' }).click();
  await page.waitForTimeout(2500);
  s = await state();
  check('Guitar tabs from the player goes to the tab page', s.path.startsWith('/tabs/') && !s.player, JSON.stringify(s));
  await back();
  s = await state();
  check('Back from the tab page is Home', onHome(s), JSON.stringify(s));
} finally {
  await browser.close();
  await cleanup();
}

const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
