/** Transfer in a real browser, end to end: Settings > Library, the Transfer
 *  row, then the Transfer wizard: where the songs are now (nothing crossed
 *  out), a sheet asking where they go, what you already have, the steps
 *  one at a time with Back and Next step in the bottom bar, then an
 *  uploaded CSV into a new playlist: the big-number preview, Start, back
 *  where it was opened with the floating pill, the "Transfer done" card and
 *  the one list of songs to check. The Liked songs run is covered by
 *  tests/transfer-google-ui.test.mjs.
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

  // ── B. Services first ──
  await page.click('[data-testid="settings-transfer-button"]');
  await page.waitForURL('**/transfer?**');
  await page.waitForSelector('[data-testid="transfer-page"]');
  const progress = await page.$$eval('[data-testid="transfer-progress"] li', (els) => els.map((e) => e.textContent));
  check('B1 a wizard header says where you are', JSON.stringify(progress) === '["1 Where","2 How","3 Check"]', `${progress}`);
  const services = await page.$$eval('[data-testid="transfer-service-name"]', (els) => els.map((e) => e.textContent));
  check('B2 the first screen asks where the music is now, by name',
    JSON.stringify(services) === '["Spotify","YouTube Music","Apple Music","Somewhere else"]', `${services}`);
  const open = await page.$$eval('[data-testid="transfer-service-card"]', (els) =>
    Object.fromEntries(els.map((e) => [e.dataset.service, !e.disabled])));
  check('B3 every service can be picked',
    JSON.stringify(open) === '{"spotify":true,"ytmusic":true,"apple":true,"other":true}', JSON.stringify(open));
  const needs = (await page.textContent('[data-testid="transfer-service-card"][data-service="apple"]')) ?? '';
  check('B3c each row says what it needs', /The file Apple sends you/.test(needs), needs);
  await shot(page, 'chooser');

  // ── B'. A sheet asks where they go ──
  await page.click('[data-testid="transfer-service-card"][data-service="spotify"]');
  await page.waitForSelector('[data-testid="transfer-where-sheet"]');
  const cards = await page.$$eval('[data-testid="transfer-where-sheet"] [data-testid="transfer-destination-card"]', (els) => els.map((e) => e.dataset.destination));
  check('B3d picking a service opens a sheet with the two places', JSON.stringify(cards) === '["liked","playlist"]', `${cards}`);
  const checked = await page.getAttribute('[data-testid="transfer-where-sheet"] [data-destination="liked"]', 'aria-checked');
  check('B3e Liked songs is picked to start with', checked === 'true', `${checked}`);
  await shot(page, 'where-to');
  // A file makes a new playlist from any service.
  await page.click('[data-testid="transfer-where-sheet"] [data-destination="playlist"]');
  await page.locator('[data-testid="transfer-where-sheet"]').getByRole('button', { name: 'Continue' }).click();

  // ── B''. What do you have already? ──
  const options = await page.$$eval('[data-testid="transfer-have-label"]', (els) => els.map((e) => e.textContent));
  check('B4 and what is already in hand, not which route to take',
    JSON.stringify(options) === JSON.stringify([
      'A link to a playlist',
      'Nothing yet, but I can wait a few days',
      'A file someone gave me, or one I downloaded',
    ]), `${options}`);
  await shot(page, 'what-you-have');
  await page.click('[data-testid="transfer-have-option"][data-route="spotify-converter"]');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
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
  const big = await page.textContent('[data-testid="transfer-preview-count"]');
  const sentence = await page.textContent('[data-testid="transfer-preview-sentence"]');
  check('C1 the preview says how many as one big number, and where they go',
    big === '3' && /songs to bring into a new playlist/.test(sentence ?? ''), `${big} ${sentence}`);
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
  check('D2 it goes back to where it was opened, with the floating pill showing', true);
  await shot(page, 'running');

  // ── E. It finishes: a notification, then the one list ──
  await page.waitForSelector('[data-testid="transfer-notification"]', { timeout: 60_000 });
  const result = await page.textContent('[data-testid="transfer-notification-result"]');
  check('E1 a "Transfer done" notification says the result', /We found/.test(result ?? ''), `${result}`);
  await shot(page, 'done');
  await page.locator('[data-testid="transfer-notification"]').getByRole('button', { name: /^Check \d+ songs?$/ }).click();
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
