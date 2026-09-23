/** Transfer in a real browser, end to end: Settings > Library, the Transfer
 *  row, then the three plain questions (where the songs land, where the
 *  music is now, what you already have). For Liked songs only YouTube
 *  Music is open for now, so it checks the others are crossed out, then
 *  runs an uploaded CSV into a new playlist: its preview, Start, and the
 *  playlist page with the import and the songs. The Liked songs page run
 *  is covered by tests/transfer-google-ui.test.mjs.
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

  // ── B. Destination first, as two cards ──
  await page.click('[data-testid="settings-transfer-button"]');
  await page.waitForSelector('[data-testid="transfer-dialog"]');
  const cards = await page.$$eval('[data-testid="transfer-destination-card"]', (els) => els.map((e) => e.dataset.destination));
  check('B1 the dialog asks where the songs land, as two cards', JSON.stringify(cards) === '["liked","playlist"]', `${cards}`);
  await shot(page, 'destination');
  await page.click('[data-testid="transfer-destination-card"][data-destination="liked"]');
  await page.waitForSelector('[data-testid="transfer-chosen-destination"]');
  const chosen = await page.textContent('[data-testid="transfer-chosen-destination"]');
  check('B2 picking Liked songs opens the source step and says so', /Liked songs/.test(chosen ?? ''), `${chosen}`);

  // ── B'. Where is your music now? ──
  const services = await page.$$eval('[data-testid="transfer-service-card"]', (els) => els.map((e) => e.textContent));
  check('B3 then it asks where the music is now, by name',
    JSON.stringify(services) === '["Spotify","YouTube Music","Apple Music","Somewhere else"]', `${services}`);
  // For now only YouTube Music may fill the Liked songs: the others are
  // crossed out and cannot be pressed (LIKED_SERVICES_OPEN).
  const open = await page.$$eval('[data-testid="transfer-service-card"]', (els) =>
    Object.fromEntries(els.map((e) => [e.dataset.service, !e.disabled])));
  check('B3b for Liked songs only YouTube Music can be picked',
    JSON.stringify(open) === '{"spotify":false,"ytmusic":true,"apple":false,"other":false}', JSON.stringify(open));
  const heldBack = await page.textContent('[data-testid="transfer-services-held-back"]').catch(() => '');
  check('B3c and the dialog says why, in a sentence', /only YouTube Music/.test(heldBack ?? ''), `${heldBack}`);
  await shot(page, 'liked-locked');

  // A file still makes a new playlist from any service: go back one step.
  await page.getByRole('button', { name: /Back/ }).click();
  await page.click('[data-testid="transfer-destination-card"][data-destination="playlist"]');
  await page.waitForSelector('[data-testid="transfer-service-card"][data-service="spotify"]:not([disabled])');
  await page.click('[data-testid="transfer-service-card"][data-service="spotify"]');

  // ── B''. What do you have already? ──
  const options = await page.$$eval('[data-testid="transfer-have-option"]', (els) => els.map((e) => e.textContent));
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
  check('B5 only that one combination\u2019s steps show',
    /Exportify/.test(stepsText ?? '') && !/Download your data/.test(stepsText ?? ''), `${(stepsText ?? '').slice(0, 120)}`);
  check('B6 and the steps say songs are looked up by name', /looks each song up by name/.test(stepsText ?? ''));
  const startOffBefore = await page.getByRole('button', { name: /^Transfer$/ }).isDisabled();
  check('B7 nothing can be started before Ember has read a source', startOffBefore);

  // ── C. An uploaded CSV, previewed before anything happens ──
  await page.setInputFiles('input[type="file"][aria-label="Song list file"]', FIXTURE);
  await page.waitForSelector('[data-testid="transfer-preview"]', { timeout: 20_000 });
  const preview = await page.textContent('[data-testid="transfer-preview"]');
  check('C1 the preview names the source and the count', /Liked songs from Spotify/.test(preview ?? '') && /3 songs/.test(preview ?? ''), `${preview}`);
  check('C2 and the first songs, so a wrong file is obvious', /Paper Lanterns/.test(preview ?? ''), `${preview}`);
  await shot(page, 'preview');

  // ── D. Start, and the new playlist takes over ──
  const start = page.getByRole('button', { name: /^Transfer 3 songs$/ });
  check('D1 Start is on once the preview is there', await start.count() === 1 && !(await start.isDisabled()));
  await start.click();
  await page.waitForURL('**/playlist/**', { timeout: 20_000 });
  await page.waitForSelector('[data-testid="import-progress-banner"], [data-testid="import-summary"]', { timeout: 20_000 });
  check('D2 it lands on the new playlist with the import showing', true);
  await shot(page, 'running');

  // ── E. It finishes, and the songs are in the playlist ──
  await page.waitForSelector('[data-testid="import-summary"]', { timeout: 60_000 });
  const summary = await page.textContent('[data-testid="import-summary"]');
  check('E1 the import says it finished', (summary ?? '').length > 0, `${(summary ?? '').slice(0, 160)}`);
  await page.waitForFunction(() => document.body.innerText.includes('Paper Lanterns'), null, { timeout: 30_000 });
  check('E2 a transferred song is in the playlist', (await page.textContent('body'))?.includes('Paper Lanterns') ?? false);
  await shot(page, 'done');

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
