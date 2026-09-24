/** The /dizajn desktop top bar candidates in a real browser (owner: the
 *  scrollbar starts under the search bar, and a scrolled page runs right up
 *  to the pill; a padded gap was rejected because it pushed the page down).
 *  For every candidate (Floating pill, Frosted bar, Solid strip, As it is):
 *
 *  - six shots render: top and scrolled at 1280 and 1920, plus Midnight and
 *    Mono scrolled;
 *  - the drawn scrollbar starts at the top of the column (a to c) or 80px
 *    down (As it is);
 *  - at scroll top the heading starts 32px under the pill in every
 *    candidate (no added distance);
 *  - scrolled, a to c keep a >= 16px band under the pill that the bar
 *    covers (hit-tested: the topmost element there belongs to the bar, not
 *    the page);
 *  - nothing overflows horizontally, no page errors.
 *
 *      node tests/topbar-gallery-ui.test.mjs
 *
 *  Signs in (EMBER_EMAIL / EMBER_PASSWORD) and opens /dizajn. SHOT_DIR
 *  keeps a screenshot of each candidate's 1920 shots. Writes nothing. */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.error('needs playwright-core: npm i -D playwright-core'); process.exit(2); }

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8088';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3054';
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

// [id, scrollbar top px, band px when scrolled]
const CANDIDATES = [
  ['float', 0, 16],
  ['frosted', 0, 16],
  ['solid', 0, 16],
  ['now', 80, 0],
];

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1200 }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: 'pb_auth', value: cookie, url: APP_URL }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${APP_URL}/dizajn`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="topbar-section"]', { timeout: 20_000 });

  const badges = await page.locator('[data-testid="topbar-recommended-badge"]').count();
  check('exactly one candidate marked Recommended', badges === 1, `${badges}`);

  for (const [id, sbTop, band] of CANDIDATES) {
    const shots = page.locator(`[data-testid="topbar-shot"][data-candidate="${id}"]`);
    check(`${id}: six shots`, (await shots.count()) === 6, `${await shots.count()}`);

    for (let i = 0; i < 6; i++) {
      const shot = shots.nth(i);
      await shot.scrollIntoViewIfNeeded();
      const m = await shot.evaluate((el) => {
        const frame = el.querySelector('[data-testid="topbar-frame"]');
        const scale = frame.getBoundingClientRect().width / frame.offsetWidth;
        const f = frame.getBoundingClientRect();
        const pill = frame.querySelector('[data-testid="topbar-pill"]').getBoundingClientRect();
        const heading = frame.querySelector('[data-testid="topbar-heading"]').getBoundingClientRect();
        const sb = frame.querySelector('[data-testid="topbar-scrollbar"]').getBoundingClientRect();
        const bandEl = frame.querySelector('[data-testid="topbar-band"]');
        // Hit-test the middle of the band: covers are pointer-events-none
        // (they must never block a click), so lift that for the probe only.
        const style = document.createElement('style');
        style.textContent = '[data-testid="topbar-frame"] * { pointer-events: auto !important; }';
        document.head.append(style);
        const probe = document.elementFromPoint(pill.left + 40 * scale, pill.bottom + 8 * scale);
        style.remove();
        const px = (v) => Math.round(v / scale);
        return {
          width: el.dataset.width,
          scroll: Number(el.dataset.scroll),
          preset: el.dataset.preset,
          scrollbarTop: px(sb.top - f.top),
          headingGap: px(heading.top - pill.bottom),
          band: bandEl ? px(bandEl.getBoundingClientRect().bottom - pill.bottom) : 0,
          probeInBar: !!probe?.closest('[data-testid="topbar-bar"]'),
          probeInPage: !!probe?.closest('[data-testid="topbar-heading"], .grid, .flex-col'),
        };
      });
      const at = `${id} ${m.width}px ${m.preset} scroll ${m.scroll}`;
      check(`${at}: scrollbar starts at ${sbTop}px`, Math.abs(m.scrollbarTop - sbTop) <= 2, `${m.scrollbarTop}`);
      if (m.scroll === 0) {
        check(`${at}: heading 32px under the pill`, Math.abs(m.headingGap - 32) <= 2, `${m.headingGap}`);
      } else if (band > 0) {
        check(`${at}: band under the pill >= 16px`, m.band >= 15, `${m.band}`);
        check(`${at}: the band is covered by the bar`, m.probeInBar, JSON.stringify(m));
      } else {
        check(`${at}: no band (content right under the pill)`, !m.probeInBar, JSON.stringify(m));
      }
    }

    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      for (const scroll of [0, 300]) {
        const shot = page.locator(`[data-testid="topbar-shot"][data-candidate="${id}"][data-width="1920"][data-scroll="${scroll}"][data-preset="ember"]`);
        await shot.scrollIntoViewIfNeeded();
        await shot.screenshot({ path: path.join(SHOTS, `topbar-1920-${id}-${scroll ? 'scrolled' : 'top'}.png`) });
      }
      for (const preset of ['midnight', 'mono']) {
        const shot = page.locator(`[data-testid="topbar-shot"][data-candidate="${id}"][data-preset="${preset}"]`);
        await shot.scrollIntoViewIfNeeded();
        await shot.screenshot({ path: path.join(SHOTS, `topbar-1280-${id}-${preset}.png`) });
      }
    }
  }

  const overflow = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth }));
  check('no horizontal overflow', overflow.scrollW <= overflow.innerW, `${overflow.scrollW} vs ${overflow.innerW}`);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
