/** UI check for the Home "Trending right now" shelf against the fake player,
 *  blended across TRENDING_COUNTRIES.
 *
 *      node tests/trending-ui.test.mjs   # or: npm run test:trending-ui
 *
 *  Starts its OWN app server (twice) from the existing build in apps/web,
 *  with tests/fake-player.sh as the player and a fresh MUSIC_DIR, so the
 *  chart cache starts cold. Needs a sandbox PocketBase (PB_URL) and a build
 *  made with POCKETBASE_URL pointing at it. TRENDING_COUNTRIES=US,GB,DE,RS;
 *  the fake serves each country the same 10 "Chart Song" tracks (same rank
 *  order everywhere) plus 2 country-exclusive tracks, so the blended order
 *  (shared songs first, then each country's exclusives) proves the blend
 *  runs end to end, not just a single country's chart. Proves, in a real
 *  browser:
 *   - T1: the shelf shows the blended chart in rank order
 *   - T2: /api/youtube/trending answers the same order, fresh (stale: false),
 *     lists the blended countries in `source`, and the search empty state
 *     ("Trending") is the same chart
 *   - T3: after a good fetch, with the chart 13 h old and the source failing
 *     (FAKE_FAIL_TRENDING=1, server restarted), the shelf still shows the
 *     last good list, and the API marks it stale with the old fetchedAt
 *   - T4: the server did try the source (and failed) rather than never asking
 *
 *  Env: PB_URL (default http://127.0.0.1:8096), APP_PORT (default 3029),
 *  PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD, SB (scratch dir), CHROME_PATH. */
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('This test needs playwright-core:\n\n  npm i -D playwright-core\n');
  process.exit(2);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'apps/web');
const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8096';
const PORT = process.env.APP_PORT ?? '3029';
const APP_URL = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL ?? 'admin@ember.com';
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD ?? 'egKa5WNMx3QpuG7';
const SB = process.env.SB ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ember-trending-ui-'));
const MUSIC = path.join(SB, 'music');
const CALLS = path.join(SB, 'calls.log');
const PW = 'TrendTest2026!';
const BLEND_COUNTRIES = ['US', 'GB', 'DE', 'RS'];
// Matches tests/fake-player.sh's trending case: 10 shared songs (same rank
// in every country, so they outscore any single country's exclusives), then
// each country's rank-11 exclusive, then each country's rank-12 exclusive.
const EXPECTED = [
  ...Array.from({ length: 10 }, (_, i) => `Chart Song ${String(i + 1).padStart(2, '0')}`),
  ...BLEND_COUNTRIES.map((c) => `${c} Extra A`),
  ...BLEND_COUNTRIES.map((c) => `${c} Extra B`),
];

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

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `next start` on PORT with the fake player; resolves once it answers. */
async function startApp(extraEnv = {}) {
  const child = spawn('npx', ['next', 'start', '-p', PORT, '-H', '127.0.0.1'], {
    cwd: WEB,
    env: {
      ...process.env,
      POCKETBASE_URL: PB_URL,
      POCKETBASE_ADMIN_EMAIL: ADMIN_EMAIL,
      POCKETBASE_ADMIN_PASSWORD: ADMIN_PASSWORD,
      DISCORD_BUG_REPORT_WEBHOOK_URL: 'http://127.0.0.1:1/none',
      PYTHON_BIN: '/bin/bash',
      PLAYER_SCRIPT: path.join(ROOT, 'tests/fake-player.sh'),
      MUSIC_DIR: MUSIC,
      FAKE_PLAYER_LOG: CALLS,
      STREAM_CACHE_WARM: '0',
      TRENDING_COUNTRY: '',
      TRENDING_COUNTRIES: BLEND_COUNTRIES.join(','),
      ...extraEnv,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: true,
  });
  let err = '';
  child.stderr.on('data', (d) => { err += d.toString(); });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${APP_URL}/api/health`).catch(() => fetch(APP_URL));
      if (r.status < 500) return child;
    } catch {}
    await sleep(500);
  }
  child.kill();
  throw new Error(`app did not start on ${PORT}: ${err.slice(-400)}`);
}

async function stopApp(child) {
  // Kill the whole group: npx -> next -> its server worker.
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  for (let i = 0; i < 20; i++) {
    const up = await fetch(APP_URL).then(() => true, () => false);
    if (!up) return;
    await sleep(250);
  }
}

async function adminToken() {
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const r = await fetch(PB_URL + p, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: ADMIN_EMAIL, password: ADMIN_PASSWORD }) });
    if (r.ok) return (await r.json()).token;
  }
  throw new Error('no admin');
}

async function shelfTitles(page) {
  const shelf = page.locator('section', { has: page.getByRole('heading', { name: 'Trending right now' }) });
  await shelf.getByRole('listitem').first().waitFor({ timeout: 20000 });
  return shelf.getByRole('listitem').locator('div.font-semibold').allTextContents();
}

// Guard: never collide with something already on the port.
if (await fetch(APP_URL).then(() => true, () => false)) {
  console.error(`Something already listens on ${APP_URL}; set APP_PORT to a free port.`);
  process.exit(2);
}
fs.rmSync(MUSIC, { recursive: true, force: true });
fs.mkdirSync(MUSIC, { recursive: true });
fs.rmSync(CALLS, { force: true });

// ── a throwaway signed-in user ──
const tok = await adminToken();
const email = `trendui-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
await fetch(`${PB_URL}/api/collections/users/records`, { method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: tok },
  body: JSON.stringify({ email, password: PW, passwordConfirm: PW, name: 'Trending Tester', verified: true }) });
const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PW }) })
  .then((r) => r.json());
const cookieValue = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));
const cookie = `pb_auth=${cookieValue}`;
const api = (p) => fetch(APP_URL + p, { headers: { cookie } }).then((r) => r.json());

const browser = await chromium.launch({ executablePath: findChrome() });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addCookies([{ name: 'pb_auth', value: cookieValue, url: APP_URL }]);
const page = await context.newPage();

let app;
try {
  // ── T1/T2: cold start, good source ──
  app = await startApp();
  await page.goto(`${APP_URL}/`);
  const first = await shelfTitles(page);
  check('T1 shelf shows the chart in rank order', JSON.stringify(first) === JSON.stringify(EXPECTED.slice(0, first.length)) && first.length >= 2,
    JSON.stringify(first));

  const fresh = await api('/api/youtube/trending');
  check('T2 API answers the chart in rank order', JSON.stringify(fresh.tracks?.map((t) => t.title)) === JSON.stringify(EXPECTED),
    JSON.stringify(fresh.tracks?.map((t) => t.title)));
  check('T2 API marks it fresh', fresh.stale === false && !!fresh.fetchedAt,
    JSON.stringify({ stale: fresh.stale, fetchedAt: fresh.fetchedAt }));
  check('T2 API lists the blended countries in `source`', JSON.stringify(fresh.source) === JSON.stringify(BLEND_COUNTRIES),
    JSON.stringify(fresh.source));
  const search = await api('/api/search?q=');
  check('T2 search empty state is the same chart', JSON.stringify(search.tracks?.map((t) => t.title)) === JSON.stringify(EXPECTED));
  check('T2 chart mirrored to MUSIC_DIR/trending.json', fs.existsSync(path.join(MUSIC, 'trending.json')));
  await stopApp(app);
  app = null;

  // ── T3/T4: the chart is 13 h old and the source is down ──
  const file = path.join(MUSIC, 'trending.json');
  const mirror = JSON.parse(fs.readFileSync(file, 'utf8'));
  const aged = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(file, JSON.stringify({ ...mirror, fetchedAt: aged }));
  const callsBefore = fs.readFileSync(CALLS, 'utf8').split('\n').filter((l) => l.startsWith('trending')).length;

  app = await startApp({ FAKE_FAIL_TRENDING: '1' });
  await page.goto(`${APP_URL}/`);
  const again = await shelfTitles(page);
  check('T3 shelf still shows the last good list', JSON.stringify(again) === JSON.stringify(first), JSON.stringify(again));
  const stale = await api('/api/youtube/trending');
  check('T3 API serves the last good list, stale, with its old fetchedAt',
    stale.stale === true && stale.fetchedAt === aged && JSON.stringify(stale.tracks?.map((t) => t.title)) === JSON.stringify(EXPECTED),
    JSON.stringify({ stale: stale.stale, fetchedAt: stale.fetchedAt, n: stale.tracks?.length }));
  await sleep(1000);
  const callsAfter = fs.readFileSync(CALLS, 'utf8').split('\n').filter((l) => l.startsWith('trending')).length;
  check('T4 the server tried the failing source once', callsAfter - callsBefore === 1, `${callsAfter - callsBefore} call(s)`);
} catch (e) {
  check('run', false, e.message);
} finally {
  if (app) await stopApp(app);
  await browser.close();
}

const failed = checks.filter(([, ok]) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
