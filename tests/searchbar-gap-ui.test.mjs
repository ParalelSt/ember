/** The desktop search bar's bottom gap, in a real browser (owner's report:
 *  "the pc navbar is missing a portion at the bottom"; picked candidate,
 *  see app/(app)/dizajn/sve: Gap with a fade). Two pieces, both real app
 *  chrome now, not a /dizajn candidate:
 *
 *    - SearchDropdown.tsx's wrapper carries `pb-block` (16px) under the
 *      pill, so a scrolled page's content no longer runs up against its
 *      bottom edge.
 *    - app/(app)/layout.tsx draws a short fade at the top of
 *      `data-app-scroller`, pointer-events-none, so content fades out as
 *      it slides under the bar instead of being cut off mid-line.
 *
 *  Checked at 1280 and 1920 wide: the measured pill-to-scroller gap is
 *  16px, the fade exists and does not intercept clicks. At 390 (phone: the
 *  search bar is not in flow there, see SearchOverlayContainer.tsx) the
 *  fade is absent. No width overflows horizontally.
 *
 *      node tests/searchbar-gap-ui.test.mjs
 *
 *  Needs the sandbox from tests/README.md and playwright-core. Set
 *  CHROME_PATH to pick a browser, SHOT_DIR to keep screenshots. */
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
  // Desktop: the gap and the fade both apply.
  for (const w of [1280, 1920]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 1000 }, deviceScaleFactor: 2 });
    await ctx.addCookies([{ name: 'pb_auth', value: cookie, url: APP_URL }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${APP_URL}/`, { waitUntil: 'networkidle' });
    await page.getByPlaceholder('What do you want to listen to?').waitFor({ timeout: 20_000 });
    await page.waitForSelector('[data-app-scroller]', { timeout: 20_000 });
    const at = (s) => `${w}px: ${s}`;

    const m = await page.evaluate(() => {
      const pill = document.querySelector('input[aria-label="Search"]');
      const scroller = document.querySelector('[data-app-scroller]');
      const fade = document.querySelector('[data-testid="app-scroller-fade"]');
      if (!pill || !scroller) return null;
      const pillBottom = pill.getBoundingClientRect().bottom;
      const scrollerTop = scroller.getBoundingClientRect().top;
      const fadeRect = fade ? fade.getBoundingClientRect() : null;
      const fadeStyle = fade ? getComputedStyle(fade) : null;
      return {
        gap: Math.round(scrollerTop - pillBottom),
        fadePresent: !!fade,
        fadeVisible: !!fadeRect && fadeRect.height > 0 && fadeStyle.display !== 'none',
        fadePointerEvents: fadeStyle ? fadeStyle.pointerEvents : null,
        docScrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
      };
    });

    check(at('pill and scroller found'), !!m, JSON.stringify(m));
    if (m) {
      // 2px tolerance for subpixel rounding.
      check(at('16px gap between the pill bottom and the scroller top'), Math.abs(m.gap - 16) <= 2, `${m.gap}`);
      check(at('the fade exists'), m.fadePresent, JSON.stringify(m));
      check(at('the fade is visible on desktop'), m.fadeVisible, JSON.stringify(m));
      check(at('the fade does not intercept clicks'), m.fadePointerEvents === 'none', `${m.fadePointerEvents}`);
      check(at('no horizontal overflow'), m.docScrollW <= m.innerW, `${m.docScrollW} vs ${m.innerW}`);
    }
    check(at('no page errors'), errors.length === 0, errors.join(' | '));

    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, `searchbar-gap-${w}.png`) }).catch(() => {});
    }
    await ctx.close();
  }

  // Phone: the search bar is not in flow (SearchOverlayContainer.tsx hides
  // the dropdown for the sheet variant), so neither the gap wrapper nor the
  // fade applies. The fade is `hidden md:block`, so it must not be visible.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await ctx.addCookies([{ name: 'pb_auth', value: cookie, url: APP_URL }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${APP_URL}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-app-scroller]', { timeout: 20_000 });

    const m = await page.evaluate(() => {
      const fade = document.querySelector('[data-testid="app-scroller-fade"]');
      const fadeRect = fade ? fade.getBoundingClientRect() : null;
      const fadeStyle = fade ? getComputedStyle(fade) : null;
      return {
        fadeVisible: !!fadeRect && fadeRect.height > 0 && fadeStyle.display !== 'none',
        docScrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
      };
    });

    check('390px: the fade is absent on the phone layout', !m.fadeVisible, JSON.stringify(m));
    check('390px: no horizontal overflow', m.docScrollW <= m.innerW, `${m.docScrollW} vs ${m.innerW}`);
    check('390px: no page errors', errors.length === 0, errors.join(' | '));

    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, 'searchbar-gap-390.png') }).catch(() => {});
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
