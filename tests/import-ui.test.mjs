/** Playlist import in the browser, stages 3 and 4 of docs/imports.md: the
 *  create-playlist dialog's Tabs, the background job with the sidebar ring,
 *  a server restart mid-import, a 503 backoff, the Done summary, the Side
 *  sheet review (key 2, S) and "Wrong song? Re-match" from a track's menu.
 *
 *      node tests/import-ui.test.mjs        # or: npm run test:import-ui
 *
 *  Needs playwright-core and a Chromium (CHROME_PATH, or the Playwright
 *  cache), PocketBase on PB_URL (default :8094) and nothing on APP_PORT
 *  (default 3034): the test starts the app itself, from apps/web's last
 *  `next build`, because it has to stop and restart it mid-import. It also
 *  starts tests/fake-spotify.mjs on :4331 (or reuses one) and points the app
 *  at tests/fake-player.sh, so nothing reaches the internet. */
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeSpotify, TOP_HITS_ID } from './fake-spotify.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('This test needs playwright-core:\n\n  npm i -D playwright-core\n');
  process.exit(2);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'apps/web');
const PB = process.env.PB_URL ?? 'http://127.0.0.1:8094';
const PORT = Number(process.env.APP_PORT ?? 3034);
const APP = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL ?? 'admin@ember.com';
const ADMIN_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD ?? 'egKa5WNMx3QpuG7';
const PW = 'ImportUi2026!';
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-import-ui-'));
const FLAG_503 = path.join(SB, '503.flag');
fs.mkdirSync(path.join(SB, 'music'));

const out = [];
const check = (name, pass, detail = '') => {
  out.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// ── The app server, started and stopped by the test ──
let server = null;
async function startApp() {
  server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    cwd: WEB,
    detached: true,
    stdio: ['ignore', fs.openSync(path.join(SB, 'app.log'), 'a'), fs.openSync(path.join(SB, 'app.log'), 'a')],
    env: {
      ...process.env,
      POCKETBASE_URL: PB,
      POCKETBASE_ADMIN_EMAIL: ADMIN_EMAIL,
      POCKETBASE_ADMIN_PASSWORD: ADMIN_PASSWORD,
      SPOTIFY_EMBED_BASE: 'http://127.0.0.1:4331',
      PYTHON_BIN: '/bin/bash',
      PLAYER_SCRIPT: path.join(ROOT, 'tests/fake-player.sh'),
      FAKE_PLAYER_LOG: path.join(SB, 'calls.log'),
      MUSIC_DIR: path.join(SB, 'music'),
      FAKE_503_ONCE: FLAG_503,
      // Slow enough that the test can stop the server mid-import.
      FAKE_MATCH_SECONDS: '0.5',
      // A restarted server takes over a job whose heartbeat is 3 s old.
      IMPORT_STALE_MS: '3000',
      CLEANUP_DISABLED: '1',
      DISCORD_BUG_REPORT_WEBHOOK_URL: 'http://127.0.0.1:1/none',
    },
  });
  for (let i = 0; i < 120; i++) {
    const ok = await fetch(`${APP}/auth`).then((r) => r.ok).catch(() => false);
    if (ok) return;
    await sleep(250);
  }
  throw new Error(`the app did not start on :${PORT}, see ${SB}/app.log`);
}
async function stopApp() {
  if (!server) return;
  try {
    process.kill(-server.pid, 'SIGKILL');
  } catch {
    // already gone
  }
  server = null;
  for (let i = 0; i < 40; i++) {
    const up = await fetch(`${APP}/auth`).then(() => true).catch(() => false);
    if (!up) return;
    await sleep(250);
  }
}

if (await fetch(`${APP}/auth`).then(() => true).catch(() => false)) {
  console.error(`Something is already listening on :${PORT}; this test starts its own app there.`);
  process.exit(2);
}

let fake = null;
try {
  fake = await startFakeSpotify();
} catch (e) {
  if (e.code !== 'EADDRINUSE') throw e;
  console.log('fake Spotify already running on :4331, reusing it');
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
const email = `import-ui-${Date.now()}-${Math.floor(Math.random() * 1e5)}@ember.test`;
const userRec = await fetch(`${PB}/api/collections/users/records`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: tok },
  body: JSON.stringify({ email, password: PW, passwordConfirm: PW, name: 'Import UI', verified: true }),
}).then((r) => r.json());
const auth = await fetch(`${PB}/api/collections/users/auth-with-password`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identity: email, password: PW }),
}).then((r) => r.json());
const cookieValue = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));
const cookie = `pb_auth=${cookieValue}`;
const api = (p, init = {}) =>
  fetch(APP + p, { ...init, headers: { 'content-type': 'application/json', cookie, ...(init.headers ?? {}) } }).then(async (r) => ({
    status: r.status,
    body: await r.json().catch(() => null),
  }));

let browser = null;
try {
  await startApp();
  browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: 'pb_auth', value: cookieValue, url: APP }]);
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // ── U1. One way in: the old Import buttons are gone ──
  await page.goto(`${APP}/library`);
  await page.getByRole('heading', { name: 'Your library' }).waitFor({ timeout: 30_000 });
  const oldButtons =
    (await page.getByRole('button', { name: 'Import', exact: true }).count()) +
    (await page.getByText('Import a playlist from Spotify or YouTube Music').count());
  check('U1 the library has no Import button any more', oldButtons === 0, `found ${oldButtons}`);

  // ── U2. The Tabs dialog: paste a link, preview, Create ──
  await page.getByRole('button', { name: 'New playlist' }).first().click();
  const dialog = page.getByTestId('create-playlist-dialog');
  await dialog.waitFor();
  const tabs = await dialog.getByRole('tab').allTextContents();
  check('U2 "+" opens New playlist with two tabs, Start empty first', JSON.stringify(tabs) === '["Start empty","Import from a link"]' &&
    (await dialog.getByRole('tab', { name: 'Start empty' }).getAttribute('aria-selected')) === 'true', JSON.stringify(tabs));
  check('U2b the dialog has no separate import link any more', (await dialog.getByText('Import a playlist from').count()) === 0);
  await dialog.getByRole('tab', { name: 'Import from a link' }).click();
  await dialog.getByLabel('Playlist link').fill(`https://open.spotify.com/playlist/${TOP_HITS_ID}`);
  const preview = dialog.getByTestId('link-preview');
  await preview.waitFor({ timeout: 20_000 });
  const previewText = await preview.textContent();
  check('U3 the pasted link previews name, song count and source', /Today’s Top Hits/.test(previewText) && /50 songs/.test(previewText) && /Spotify/.test(previewText),
    previewText);
  await dialog.getByRole('button', { name: 'Create, import 50 songs' }).click();
  await page.waitForURL(/\/playlist\/[a-z0-9]+$/, { timeout: 20_000 });
  const playlistId = page.url().split('/').pop();
  // The dialog animates out, then leaves the page.
  const closed = await page.getByTestId('create-playlist-dialog').waitFor({ state: 'detached', timeout: 5_000 }).then(() => true, () => false);
  check('U4 Create closes the dialog and opens the new playlist', closed, page.url());

  const pl0 = await api(`/api/playlists/${playlistId}`);
  const jobId = pl0.body?.playlist?.import_job;
  check('U5 the playlist carries its import job', !!jobId, JSON.stringify(pl0.body?.playlist));

  // ── U6. The sidebar ring counts up ──
  const navRow = page.getByTestId('import-nav-row');
  await navRow.waitFor({ timeout: 15_000 });
  const ring = navRow.getByRole('progressbar');
  const seen = [];
  for (let i = 0; i < 20 && new Set(seen).size < 2; i++) {
    seen.push(Number(await ring.getAttribute('aria-valuenow')));
    await sleep(700);
  }
  const navText = await navRow.textContent();
  check('U6 the sidebar row shows "N of 50" and its ring counts up', /\d+ of 50/.test(navText) && new Set(seen).size >= 2 &&
    seen.every((v, i) => i === 0 || v >= seen[i - 1]), `${navText} ${JSON.stringify(seen)}`);
  check('U7 the playlist page shows the slim progress banner', (await page.getByTestId('import-progress-banner').count()) === 1);

  // ── U8. A restart mid-import resumes from the cursor ──
  let job = null;
  for (let i = 0; i < 80; i++) {
    job = (await api(`/api/import/jobs/${jobId}`)).body?.job;
    if (job && job.cursor >= 8) break;
    await sleep(250);
  }
  const before = job?.cursor ?? 0;
  await stopApp();
  const afterStop = await fetch(`${PB}/api/collections/import_jobs/records/${jobId}`, { headers: { Authorization: tok } }).then((r) => r.json());
  check('U8 the server stopped mid-import', afterStop.status === 'running' && afterStop.cursor > 0 && afterStop.cursor < 50,
    `status ${afterStop.status} cursor ${afterStop.cursor} (${before} when stopped)`);
  // The next match call after the restart fails like YouTube Music's 503.
  fs.writeFileSync(FLAG_503, '1');
  await startApp();

  // ── U9. The 503 pauses the job, then it carries on to done ──
  const statuses = [];
  for (let i = 0; i < 240; i++) {
    job = (await api(`/api/import/jobs/${jobId}`)).body?.job;
    if (job && statuses[statuses.length - 1] !== job.status) statuses.push(job.status);
    if (job?.status === 'done' || job?.status === 'failed') break;
    await sleep(250);
  }
  check('U9 after the restart the job resumes and finishes', job?.status === 'done' && job?.cursor === 50 && afterStop.cursor < 50,
    `statuses ${JSON.stringify(statuses)} cursor ${job?.cursor}`);
  check('U10 the 503 paused it with a retry time, then it continued', statuses.includes('paused') &&
    statuses.indexOf('running', statuses.indexOf('paused')) > -1 && !fs.existsSync(FLAG_503), JSON.stringify(statuses));

  // ── U11. The playlist filled in source order; the Done summary counts ──
  const pl = await api(`/api/playlists/${playlistId}`);
  const order = pl.body?.tracks?.map((t) => t.sourceId);
  check('U11 the playlist filled in source order', JSON.stringify(order) === JSON.stringify(['D70Ld2UoZVI', 'hateThat002', 'bbyWow00001', 'aintInLA001']),
    JSON.stringify(order));
  await page.reload();
  const summary = page.getByTestId('import-summary');
  await summary.waitFor({ timeout: 30_000 });
  const counts = {
    added: await summary.getByTestId('import-count-added').textContent(),
    review: await summary.getByTestId('import-count-need-review').textContent(),
    missing: await summary.getByTestId('import-count-not-found').textContent(),
  };
  check('U12 the Done summary counts match the job', counts.added === `${job.accepted} added` && counts.review === `${job.review} need review` &&
    counts.missing === `${job.missing} not found` && job.accepted === 4 && job.review === 2 && job.missing === 44, JSON.stringify(counts));
  const navDone = await page.getByTestId('import-nav-row').textContent();
  check('U13 the sidebar row now says what is left to review', /2 to review/.test(navDone ?? ''), navDone);
  const rowPositions = await page.getByTestId('import-track-list').locator('[data-testid^="import-row-"]').evaluateAll((els) =>
    els.slice(0, 3).map((e) => `${e.getAttribute('data-testid')}:${e.getAttribute('data-position')}`),
  );
  check('U14 the unsure songs sit at their source positions in the list', JSON.stringify(rowPositions) ===
    JSON.stringify(['import-row-review:2', 'import-row-review:4', 'import-row-missing:6']), JSON.stringify(rowPositions));

  // ── U15. The Side sheet: key 2 picks, S skips ──
  await summary.getByRole('button', { name: /Review/ }).click();
  const sheet = page.getByTestId('review-sheet');
  await sheet.waitFor();
  const pos = sheet.getByTestId('review-position');
  check('U15 Review opens the side sheet on the first unsure song', /^1 of 46/.test((await pos.textContent()) ?? '') &&
    /Loser/.test((await sheet.getByTestId('review-source').textContent()) ?? ''), await pos.textContent());
  const box = await sheet.boundingBox();
  check('U16 on desktop it is a right-side sheet', !!box && box.x > 900 && box.height > 800, JSON.stringify(box));
  await page.keyboard.press('2');
  await page.waitForFunction(() => /^2 of 46/.test(document.querySelector('[data-testid="review-position"]')?.textContent ?? ''), null, {
    timeout: 15_000,
  });
  const afterPick = (await api(`/api/playlists/${playlistId}`)).body?.tracks?.map((t) => t.sourceId);
  check('U17 key 2 put the second candidate in at its source position', JSON.stringify(afterPick) ===
    JSON.stringify(['D70Ld2UoZVI', 'hateThat002', 'loserStudio', 'bbyWow00001', 'aintInLA001']), JSON.stringify(afterPick));
  check('U18 the sheet moved on to the next song', /Earrings/.test((await sheet.getByTestId('review-source').textContent()) ?? ''));
  await page.keyboard.press('s');
  await page.waitForFunction(() => /^3 of 46/.test(document.querySelector('[data-testid="review-position"]')?.textContent ?? ''), null, {
    timeout: 5_000,
  });
  const items = (await api(`/api/import/jobs/${jobId}`)).body?.items ?? [];
  check('U19 S skipped Earrings: still waiting for a look, nothing added', items[4]?.status === 'review' &&
    (await api(`/api/playlists/${playlistId}`)).body?.tracks?.length === 5, `${items[4]?.status}`);
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached', timeout: 5_000 });
  const listText = await page.getByTestId('import-track-list').textContent();
  check('U20 the picked song shows in the list, the skipped one stays flagged', listText.indexOf('Loser') > -1 &&
    (await page.getByTestId('import-row-review').count()) === 1, '');

  // ── U21. "Wrong song? Re-match" from a track's menu ──
  const firstRow = page.getByTestId('import-track-list').locator('> div').first();
  await firstRow.hover();
  await firstRow.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: /Wrong song\? Re-match/ }).click();
  await sheet.waitFor();
  const rematchTitle = await sheet.getByRole('heading').first().textContent();
  const current = await sheet.locator('[data-current="true"]').textContent();
  check('U21 Re-match opens the sheet on that song, marking the one in the playlist', rematchTitle === 'Re-match' && /Bass Persuades/.test(current ?? '') &&
    /In the playlist/.test(current ?? ''), `${rematchTitle} ${current?.slice(0, 80)}`);
  await page.keyboard.press('2');
  await sheet.waitFor({ state: 'detached', timeout: 15_000 });
  const afterRematch = (await api(`/api/playlists/${playlistId}`)).body?.tracks?.map((t) => t.sourceId);
  check('U22 the re-match swapped the song in place', JSON.stringify(afterRematch) ===
    JSON.stringify(['rmxRmxRmx01', 'hateThat002', 'loserStudio', 'bbyWow00001', 'aintInLA001']), JSON.stringify(afterRematch));

  check('U23 no page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));
} finally {
  await browser?.close().catch(() => {});
  await stopApp();
  fake?.server.close();
  if (userRec?.id) {
    await fetch(`${PB}/api/collections/users/records/${userRec.id}`, { method: 'DELETE', headers: { Authorization: tok } }).catch(() => {});
  }
  fs.rmSync(SB, { recursive: true, force: true });
}

const failed = out.filter((c) => !c.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
process.exit(failed.length ? 1 : 0);
