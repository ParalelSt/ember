/** The /dizajn Transfer candidates in a real browser (Task 0,
 *  docs/superpowers/plans/2026-09-22-transfer-liked-songs.md): every entry
 *  point and destination candidate renders inside the app shell, the state
 *  picker switches the Liked page frames, and nothing overflows on a
 *  phone.
 *
 *      node tests/transfer-gallery-ui.test.mjs
 *
 *  Signs in (EMBER_EMAIL / EMBER_PASSWORD) and opens /dizajn at desktop and
 *  phone widths. SHOT_DIR keeps screenshots. Writes nothing. Needs the
 *  sandbox from tests/README.md. */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.error('needs playwright-core: npm i -D playwright-core'); process.exit(2); }

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8088';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3050';
const EMAIL = process.env.EMBER_EMAIL ?? 'strixparalel@gmail.com';
const PASSWORD = process.env.EMBER_PASSWORD ?? 'EmberTest2026!';
const SHOTS = process.env.SHOT_DIR ?? '';

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

const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identity: EMAIL, password: PASSWORD }),
}).then((r) => { if (!r.ok) throw new Error(`sign-in failed: ${r.status}`); return r.json(); });
const cookie = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));

const checks = [];
const check = (name, pass, detail = '') => { checks.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  : ${detail}` : ''}`); };

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
try {
  for (const [w, h] of [[1400, 1000], [390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await ctx.addCookies([{ name: 'pb_auth', value: cookie, url: APP_URL }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${APP_URL}/dizajn`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="transfer-section"]', { timeout: 20_000 });
    const at = (s) => `${w}px: ${s}`;

    const m = await page.evaluate(() => ({
      entries: [...document.querySelectorAll('[data-testid="transfer-entry-candidate"]')].map((s) => s.dataset.entry),
      destinations: [...document.querySelectorAll('[data-testid="transfer-destination-candidate"]')].map((s) => s.dataset.destination),
      dialogs: document.querySelectorAll('[data-testid="transfer-dialog"]').length,
      recommended: document.querySelectorAll('[data-testid="transfer-entry-candidate"] :is(span,div)').length > 0
        ? [...document.querySelectorAll('[data-testid="transfer-entry-candidate"]')].filter((c) => c.textContent.includes('Recommended')).length
        : 0,
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    }));
    check(at('three entry-point candidates'), JSON.stringify(m.entries) === '["liked-button","dialog-tab","settings-row"]', `${m.entries}`);
    check(at('three destination candidates'), JSON.stringify(m.destinations) === '["segmented","cards","implicit"]', `${m.destinations}`);
    check(at('every candidate shows its dialog'), m.dialogs === (m.entries.length + m.destinations.length) * 2, `${m.dialogs}`);
    check(at('exactly one entry point marked Recommended'), m.recommended === 1, `${m.recommended}`);
    check(at('nothing overflows horizontally'), m.scrollW <= m.innerW, `${m.scrollW} vs ${m.innerW}`);
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `transfer-${w}-idle.png`), fullPage: true }); }

    await page.getByRole('radio', { name: 'Running' }).click();
    const running = await page.evaluate(() => ({
      banners: document.querySelectorAll('[data-testid="transfer-liked-states"] [data-testid="import-progress-banner"]').length,
      pending: document.querySelectorAll('[data-testid="transfer-liked-states"] [data-testid="transferring-block"]').length,
    }));
    check(at('running: progress banner and the Transferring block show'), running.banners > 0 && running.pending > 0, JSON.stringify(running));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `transfer-${w}-running.png`), fullPage: true });

    await page.getByRole('radio', { name: 'Done, some missing' }).click();
    const done = await page.evaluate(() => document.querySelectorAll('[data-testid="transfer-liked-states"] [data-testid="import-summary"]').length);
    check(at('done: the summary shows'), done > 0, `${done}`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `transfer-${w}-done.png`), fullPage: true });

    check(at('no page errors'), errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
