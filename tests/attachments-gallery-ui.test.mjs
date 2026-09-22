/** The /dizajn attachment candidates in a real browser: every style draws
 *  both forms, thumbnails render as squares with a visible remove button,
 *  the too-big state disables Send, and nothing overflows on a phone.
 *
 *      node tests/attachments-gallery-ui.test.mjs
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
    await page.waitForSelector('[data-testid="attachments-section"]', { timeout: 20_000 });
    const at = (s) => `${w}px: ${s}`;

    const m = await page.evaluate(() => ({
      styles: [...document.querySelectorAll('[data-testid="attach-style"]')].map((s) => s.dataset.style),
      dialogs: document.querySelectorAll('[data-testid="attach-dialog"]').length,
      thumbs: [...document.querySelectorAll('[data-testid="attach-thumb"]')].map((t) => { const r = t.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }),
      removes: [...document.querySelectorAll('button[aria-label^="Remove"]')].filter((b) => b.getBoundingClientRect().width > 0).length,
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    }));
    check(at('three styles, two forms each'), JSON.stringify(m.styles) === '["chips","dropzone","footer"]' && m.dialogs === 6, `${m.styles} / ${m.dialogs}`);
    check(at('twelve square thumbnails'), m.thumbs.length === 12 && m.thumbs.every(([a, b]) => a === b && a >= 40), JSON.stringify(m.thumbs));
    check(at('every file has a visible remove button'), m.removes === 12, `${m.removes}`);
    check(at('nothing overflows horizontally'), m.scrollW <= m.innerW, `${m.scrollW} vs ${m.innerW}`);
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `attach-${w}-files.png`), fullPage: true }); }

    await page.getByRole('radio', { name: 'Too big' }).click();
    const big = await page.evaluate(() => ({
      problems: document.querySelectorAll('[data-testid="attach-problem"]').length,
      disabled: [...document.querySelectorAll('[data-testid="attach-dialog"] button')].filter((b) => /^Send/.test(b.textContent.trim()) && b.disabled).length,
    }));
    check(at('too big: all six forms say so and disable Send'), big.problems === 6 && big.disabled === 6, JSON.stringify(big));

    await page.getByRole('radio', { name: 'Nothing attached' }).click();
    const none = await page.evaluate(() => document.querySelectorAll('[data-testid="attach-thumb"]').length);
    check(at('nothing attached: no thumbnails'), none === 0, `${none}`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `attach-${w}-empty.png`), fullPage: true });
    check(at('no page errors'), errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
