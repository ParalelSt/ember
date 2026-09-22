/** Transfer: YouTube Music likes, straight from the account, in a real
 *  browser. Settings > Library > Transfer > Liked songs > the YouTube Music
 *  tab: paste fake request headers, Preview, Start, and land on the Liked
 *  page with the transfer running. Sibling to transfer-ytmusic.test.mjs
 *  (which drives the route directly) and transfer-ui.test.mjs (the file
 *  upload path in a browser); this one is the dialog path for the account
 *  route.
 *
 *      node tests/transfer-ytmusic-ui.test.mjs
 *
 *  Needs playwright-core and a Chromium (CHROME_PATH, or the Playwright
 *  cache), and the sandbox stack with the FAKE player, so no search and no
 *  real Google session ever leaves the machine:
 *
 *    /Users/aronmatoic/Documents/Main Projects/spotify-clone-wt/_sandbox/start-pb.sh
 *    cd apps/web && POCKETBASE_URL=http://127.0.0.1:8088 \
 *      POCKETBASE_ADMIN_EMAIL=admin@ember.com POCKETBASE_ADMIN_PASSWORD=egKa5WNMx3QpuG7 \
 *      PYTHON_BIN=/bin/bash PLAYER_SCRIPT="$PWD/../../tests/fake-player.sh" \
 *      FAKE_PLAYER_LOG=/tmp/transfer-ytm-ui-calls.log \
 *      FAKE_LIKED_STDIN=/tmp/transfer-ytm-ui-stdin.txt \
 *      DISCORD_BUG_REPORT_WEBHOOK_URL=http://127.0.0.1:8099/bug \
 *      npx next start -p 3050 &
 *
 *  The test makes its own throwaway user and deletes it afterwards; it
 *  writes nothing else. SHOT_DIR keeps screenshots. */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.error('needs playwright-core: npm i -D playwright-core'); process.exit(2); }

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PB = process.env.PB_URL ?? 'http://127.0.0.1:8088';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:3050';
const ADMIN_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL ?? 'admin@ember.com';
const ADMIN_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD ?? 'egKa5WNMx3QpuG7';
const STDIN_FILE = process.env.FAKE_LIKED_STDIN ?? '/tmp/transfer-ytm-ui-stdin.txt';
const PW = 'TransferYtmUi2026!';
const SHOTS = process.env.SHOT_DIR ?? '';

// Invented, shaped like a real fetch()-copied header block: Chrome/Edge copy
// quoted JSON lines, which normalisePastedHeaders turns into "name: value".
const SECRET = 'not-a-real-session-value';
const HEADERS_JSON = [
  '"accept": "*/*",',
  `"authorization": "SAPISIDHASH 1758500000_${SECRET}",`,
  `"cookie": "SAPISID=${SECRET}; __Secure-3PAPISID=${SECRET}; HSID=${SECRET}",`,
  '"user-agent": "Mozilla/5.0",',
  '"x-goog-authuser": "0"',
].join('\n');

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
const email = `transfer-ytm-ui-${Date.now()}-${Math.floor(Math.random() * 1e5)}@ember.test`;
const userRec = await fetch(`${PB}/api/collections/users/records`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: tok },
  body: JSON.stringify({ email, password: PW, passwordConfirm: PW, name: 'Transfer YTM UI', verified: true }),
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
  await page.screenshot({ path: path.join(SHOTS, `transfer-ytm-ui-${name}.png`), fullPage: true });
};

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: 'pb_auth', value: cookie, url: APP }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // The secret must never reach a console.log/console.error either.
  const consoleLeaks = [];
  page.on('console', (m) => { if (m.text().includes(SECRET)) consoleLeaks.push(m.text()); });

  // ── A. Settings > Library > Transfer > Liked songs > YouTube Music ──
  await page.goto(`${APP}/settings/library`, { waitUntil: 'networkidle' });
  await page.click('[data-testid="settings-transfer-button"]');
  await page.waitForSelector('[data-testid="transfer-dialog"]');
  await page.click('[data-testid="transfer-destination-card"][data-destination="liked"]');
  await page.waitForSelector('[data-testid="transfer-chosen-destination"]');
  const tabs = await page.$$eval('[role="tab"]', (els) => els.map((e) => e.textContent));
  check('A1 the YouTube Music tab is offered once Liked songs is chosen', tabs.includes('YouTube Music'), JSON.stringify(tabs));
  await page.click('role=tab[name="YouTube Music"]');
  await page.waitForSelector('[aria-label="Your YouTube Music request headers"]');
  const stepsText = await page.textContent('[data-testid="transfer-dialog"]');
  check('A2 the steps and the used-once note are on screen', /music\.youtube\.com/.test(stepsText ?? '') && /uses it once/.test(stepsText ?? ''), '');
  await shot(page, 'ytmusic-tab');

  // ── B. Paste, Preview ──
  const previewButton = page.getByRole('button', { name: /^Preview$/ });
  check('B1 Preview is off before anything is pasted', await previewButton.isDisabled());
  await page.fill('[aria-label="Your YouTube Music request headers"]', HEADERS_JSON);
  check('B2 Preview turns on once something is pasted', !(await previewButton.isDisabled()));
  await previewButton.click();
  await page.waitForSelector('[data-testid="transfer-preview"]', { timeout: 20_000 });
  const preview = await page.textContent('[data-testid="transfer-preview"]');
  check('B3 the preview names the source and the count', /Liked songs from YouTube Music/.test(preview ?? '') && /3 songs/.test(preview ?? ''), `${preview}`);
  check('B4 and the first song, so a wrong account is obvious', /Liked Song One/.test(preview ?? ''), `${preview}`);
  await shot(page, 'preview');

  // ── C. Start, and the Liked page takes over ──
  const start = page.getByRole('button', { name: /^Transfer 3 songs$/ });
  check('C1 Start is on once the preview is there', await start.count() === 1 && !(await start.isDisabled()));
  await start.click();
  await page.waitForURL('**/library/liked', { timeout: 20_000 });
  await page.waitForFunction(() => document.body.innerText.includes('Liked Song One'), null, { timeout: 30_000 });
  check('C2 a transferred song is in the likes list', (await page.textContent('body'))?.includes('Liked Song One') ?? false);
  await shot(page, 'done');

  // ── D. The paste travelled on stdin, not in the URL or on screen ──
  check(
    'D1 the headers reached the helper on stdin, not the browser',
    fs.existsSync(STDIN_FILE) && fs.readFileSync(STDIN_FILE, 'utf8').includes(SECRET),
    fs.existsSync(STDIN_FILE) ? 'stdin file written' : 'no stdin file',
  );
  check('D2 no console message ever carried the pasted secret', consoleLeaks.length === 0, consoleLeaks.join(' | '));

  // ── E. Reopening the dialog finds the textarea empty ──
  await page.click('[data-testid="settings-transfer-button"]', { timeout: 5_000 }).catch(async () => {
    await page.goto(`${APP}/settings/library`, { waitUntil: 'networkidle' });
    await page.click('[data-testid="settings-transfer-button"]');
  });
  await page.waitForSelector('[data-testid="transfer-dialog"]');
  await page.click('[data-testid="transfer-destination-card"][data-destination="liked"]');
  await page.click('role=tab[name="YouTube Music"]');
  const leftover = await page.inputValue('[aria-label="Your YouTube Music request headers"]');
  check('E1 the pasted headers are gone: cleared once the transfer started', leftover === '', `"${leftover}"`);

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
