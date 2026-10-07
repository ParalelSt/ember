/** Transfer in a real browser, end to end: Settings > Library, the Transfer
 *  row, then the Transfer page: where the songs go and where they are now
 *  on one screen (nothing crossed out), what you already have, the steps
 *  one at a time, then an uploaded CSV into a new playlist: the chips
 *  preview, Start, back where it was opened with the progress chip, the
 *  "Transfer done" notification and the one list of songs to check. The
 *  Liked songs run is covered by tests/transfer-google-ui.test.mjs.
 *
 *      node tests/transfer-ui.test.mjs
 *
 *  Needs playwright-core and a Chromium (CHROME_PATH, or the Playwright
 *  cache), and the sandbox stack with the FAKE player, so no search leaves
 *  the machine and the match is the same every run. PocketBase first (8088,
 *  this worktree's pb_hooks), then the app on 3050:
 *
 *    /Users/aronmatoic/Documents/Main Projects/spotify-clone-wt/_sandbox/start-pb.sh
 *    cd apps/web && POCKETBASE_URL=http://127.0.0.1:8088 \
 *      POCKETBASE_ADMIN_EMAIL=admin@ember.com POCKETBASE_ADMIN_PASSWORD=egKa5WNMx3QpuG7 \
 *      PYTHON_BIN=/bin/bash PLAYER_SCRIPT="$PWD/../../tests/fake-player.sh" \
 *      FAKE_PLAYER_LOG=/tmp/transfer-ui-calls.log \
 *      FAKE_MATCH_FIXTURE="$PWD/../../tests/fixtures/imports/transfer/ytm-transfer-candidates.json" \
 *      FAKE_MATCH_SECONDS=1.5 \
 *      DISCORD_BUG_REPORT_WEBHOOK_URL=http://127.0.0.1:8099/bug \
 *      npx next start -p 3050 &
 *
 *  FAKE_MATCH_SECONDS is what makes the running state visible: without it
 *  three songs are matched before the page has finished loading. The test
 *  makes its own throwaway user and deletes it afterwards; it writes
 *  nothing else. SHOT_DIR keeps screenshots. */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.error('needs playwright-core: npm i -D playwright-core'); process.exit(2); }

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures/imports/transfer/exportify.sample.csv');
const PB = process.env.PB_URL ?? 'http://127.0.0.1:8088';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:3050';
const ADMIN_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL ?? 'admin@ember.com';
const ADMIN_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD ?? 'egKa5WNMx3QpuG7';
const PW = 'TransferUi2026!';
const SHOTS = process.env.SHOT_DIR ?? '';

const out = [];
const check = (name, pass, detail = '') => {
  out.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
};

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
const email = `transfer-ui-${Date.now()}-${Math.floor(Math.random() * 1e5)}@ember.test`;
const userRec = await fetch(`${PB}/api/collections/users/records`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: tok },
  body: JSON.stringify({ email, password: PW, passwordConfirm: PW, name: 'Transfer UI', verified: true }),
}).then((r) => r.json());
const auth = await fetch(`${PB}/api/collections/users/auth-with-password`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identity: email, password: PW }),
}).then((r) => r.json());
const cookie = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));

const shot = async (page, name) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `transfer-ui-${name}.png`), fullPage: true });
};

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: 'pb_auth', value: cookie, url: APP }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // ── A. The entry point: a row in Settings ──
  await page.goto(`${APP}/settings/profile`, { waitUntil: 'networkidle' });
  // The sidebar has its own "Library" link, so the tab is found by href.
  const libraryTab = page.locator('nav a[href="/settings/library"]');
  check('A1 Settings has a Library tab', await libraryTab.count() === 1, `${await libraryTab.count()}`);
  await libraryTab.first().click();
  await page.waitForURL('**/settings/library');
  await page.waitForSelector('[data-testid="settings-transfer-button"]');
  check('A2 it holds the "Transfer from another app" row', await page.getByText('Transfer from another app').count() > 0);
  await shot(page, 'settings');

  // ── B. One page: where to on top, where from below ──
  await page.click('[data-testid="settings-transfer-button"]');
  await page.waitForURL('**/transfer?**');
  await page.waitForSelector('[data-testid="transfer-page"]');
  const cards = await page.$$eval('[data-testid="transfer-destination-card"]', (els) => els.map((e) => e.dataset.destination));
  check('B1 the page asks where the songs go, as two cards', JSON.stringify(cards) === '["liked","playlist"]', `${cards}`);
  const pressed = await page.getAttribute('[data-testid="transfer-destination-card"][data-destination="liked"]', 'aria-pressed');
  check('B2 Liked songs is picked to start with', pressed === 'true', `${pressed}`);
  await shot(page, 'chooser');

  // ── B'. Where are they now? On the same screen ──
  const services = await page.$$eval('[data-testid="transfer-service-name"]', (els) => els.map((e) => e.textContent));
  check('B3 and where the music is now, by name, on the same screen',
    JSON.stringify(services) === '["Spotify","YouTube Music","Apple Music","Somewhere else"]', `${services}`);
  const open = await page.$$eval('[data-testid="transfer-service-card"]', (els) =>
    Object.fromEntries(els.map((e) => [e.dataset.service, !e.disabled])));
  check('B3b for Liked songs every service can be picked',
    JSON.stringify(open) === '{"spotify":true,"ytmusic":true,"apple":true,"other":true}', JSON.stringify(open));
  const needs = (await page.textContent('[data-testid="transfer-service-card"][data-service="apple"]')) ?? '';
  check('B3c each row says what it needs', /The file Apple sends you/.test(needs), needs);

  // A file makes a new playlist from any service.
  await page.click('[data-testid="transfer-destination-card"][data-destination="playlist"]');
  await page.click('[data-testid="transfer-service-card"][data-service="spotify"]');

  // ── B''. What do you have already? ──
  const options = await page.$$eval('[data-testid="transfer-have-label"]', (els) => els.map((e) => e.textContent));
  check('B4 and what is already in hand, not which route to take',
    JSON.stringify(options) === JSON.stringify([
      'A link to a playlist',
      'A file someone gave me, or one I downloaded',
      'Nothing yet, but I can wait a few days',
    ]), `${options}`);
  await shot(page, 'what-you-have');
  await page.click('[data-testid="transfer-have-option"][data-route="spotify-converter"]');
  await page.waitForSelector('[data-testid="transfer-steps"]');
  const stepsText = await page.textContent('[data-testid="transfer-steps"]');
  check('B5 the steps show one at a time, with a picture',
    /Exportify/.test(stepsText ?? '') && (await page.locator('[data-testid="transfer-illustration"]').count()) === 1, `${(stepsText ?? '').slice(0, 120)}`);
  check('B6 and say songs are looked up by name', /looks each song up by name/.test(stepsText ?? ''));
  await shot(page, 'steps');
  await page.getByRole('button', { name: 'Next step' }).click();
  check('B7 the file box is on the last step', await page.locator('input[type="file"][aria-label="Song list file"]').count() === 1);

  // ── C. An uploaded CSV, previewed before anything happens ──
  await page.setInputFiles('input[type="file"][aria-label="Song list file"]', FIXTURE);
  await page.waitForSelector('[data-testid="transfer-preview"]', { timeout: 20_000 });
  const sentence = await page.textContent('[data-testid="transfer-preview-sentence"]');
  check('C1 the preview says how many and about how long', /3 songs to bring over/.test(sentence ?? ''), `${sentence}`);
  await page.click('[data-testid="transfer-chip"][data-chip="new"]');
  const songs = await page.textContent('[data-testid="transfer-chip-songs"]');
  check('C2 a count chip shows which songs it means', /Paper Lanterns/.test(songs ?? ''), `${songs}`);
  await shot(page, 'preview');

  // ── D. Start, and stay where you were ──
  const start = page.getByRole('button', { name: /^Transfer 3 songs$/ });
  check('D1 Start is on once the preview is there', await start.count() === 1 && !(await start.isDisabled()));
  await start.click();
  await page.waitForURL('**/settings/library', { timeout: 20_000 });
  await page.waitForSelector('[data-testid="transfer-chip-status"]', { timeout: 20_000 });
  check('D2 it goes back to where it was opened, with the progress chip showing', true);
  await shot(page, 'running');

  // ── E. It finishes: a notification, then the one list ──
  await page.waitForSelector('[data-testid="transfer-notification"]', { timeout: 60_000 });
  const result = await page.textContent('[data-testid="transfer-notification-result"]');
  check('E1 a "Transfer done" notification says the result', /We found/.test(result ?? ''), `${result}`);
  await shot(page, 'done');
  await page.click('[data-testid="transfer-notification"] >> text=Transfer done');
  await page.waitForURL('**/transfer/review?job=**', { timeout: 20_000 });
  await page.waitForSelector('[data-testid="transfer-review"]');
  check('E2 tapping it opens the list of songs to check', true);
  await shot(page, 'review');

  check('F1 no page errors anywhere in the flow', errors.length === 0, errors.join(' | '));
  await ctx.close();
} finally {
  await browser.close();
  if (userRec?.id) {
    await fetch(`${PB}/api/collections/users/records/${userRec.id}`, { method: 'DELETE', headers: { Authorization: tok } }).catch(() => {});
  }
}

const failed = out.filter((p) => !p).length;
console.log(`\n${out.length - failed}/${out.length} checks passed`);
process.exit(failed ? 1 : 0);
