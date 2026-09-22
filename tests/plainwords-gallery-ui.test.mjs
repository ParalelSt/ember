/** The /dizajn plain-words Transfer candidates in a real browser: all
 *  three candidates draw at desktop and at 390px, the service and state
 *  pickers switch every frame, and nothing overflows horizontally.
 *
 *      node tests/plainwords-gallery-ui.test.mjs
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

const CANDIDATES = ['one-way', 'two-way', 'what-you-have'];
const SERVICES = ['spotify', 'ytmusic', 'apple', 'other'];

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
    await page.waitForSelector('[data-testid="plainwords-section"]', { timeout: 20_000 });
    const at = (s) => `${w}px: ${s}`;

    const m0 = await page.evaluate(() => ({
      candidates: [...document.querySelectorAll('[data-testid="plainwords-candidate"]')].map((c) => c.dataset.candidate),
      dialogs: document.querySelectorAll('[data-testid="plainwords-dialog"]').length,
      recommended: document.querySelectorAll('[data-testid="plainwords-candidate"] :is(*)').length > 0
        ? [...document.querySelectorAll('[data-testid="plainwords-candidate"]')].filter((c) => /Recommended/.test(c.textContent)).length
        : 0,
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    }));
    check(at('all three candidates draw, two frames each'), JSON.stringify(m0.candidates) === JSON.stringify(CANDIDATES) && m0.dialogs === 6, `${m0.candidates} / ${m0.dialogs}`);
    check(at('exactly one candidate marked Recommended'), m0.recommended === 1, `${m0.recommended}`);
    check(at('nothing overflows horizontally (asking)'), m0.scrollW <= m0.innerW, `${m0.scrollW} vs ${m0.innerW}`);
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `plainwords-${w}-asking.png`), fullPage: true }); }

    for (const service of SERVICES) {
      await page.getByRole('radio', { name: service === 'ytmusic' ? 'YouTube Music' : service === 'other' ? 'Somewhere else' : service === 'apple' ? 'Apple Music' : 'Spotify' }).click();
      const services = await page.evaluate(() => [...document.querySelectorAll('[data-testid="plainwords-dialog"]')].map((d) => d.dataset.service));
      check(at(`service picker: every frame follows ${service}`), services.every((s) => s === service), JSON.stringify(services));
    }

    await page.getByRole('radio', { name: 'Steps shown' }).click();
    const steps = await page.evaluate(() => document.querySelectorAll('[data-testid="plainwords-steps"], [data-testid="plainwords-choice"]').length);
    check(at('steps state: every frame shows steps or a choice screen'), steps === 6, `${steps}`);
    const wAfterSteps = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth }));
    check(at('nothing overflows horizontally (steps)'), wAfterSteps.scrollW <= wAfterSteps.innerW, `${wAfterSteps.scrollW} vs ${wAfterSteps.innerW}`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `plainwords-${w}-steps.png`), fullPage: true });

    await page.getByRole('radio', { name: 'Result' }).click();
    const result = await page.evaluate(() => document.querySelectorAll('[data-testid="plainwords-result"], [data-testid="plainwords-dead-end"], [data-testid="plainwords-choice"]').length);
    check(at('result state: every frame lands on a result, a dead end, or a still-open choice'), result === 6, `${result}`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `plainwords-${w}-result.png`), fullPage: true });

    check(at('no page errors'), errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
