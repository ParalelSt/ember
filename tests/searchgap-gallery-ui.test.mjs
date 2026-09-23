/** The /dizajn search-bar-gap candidates in a real browser (owner's report:
 *  "the pc navbar is missing a portion at the bottom, could be solved by
 *  adding some padding"): every candidate (As it is, Small gap, Roomy gap,
 *  Gap with a fade) draws at 1280px and 1920px, the measured gap between
 *  the pill's bottom edge and the first content row matches the candidate's
 *  intended token (0 / 8 / 16 / 16 with a fade element), and nothing
 *  overflows horizontally.
 *
 *      node tests/searchgap-gallery-ui.test.mjs
 *
 *  Signs in (EMBER_EMAIL / EMBER_PASSWORD) and opens /dizajn at 1280 and
 *  1920 wide. SHOT_DIR keeps screenshots. Writes nothing. */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.error('needs playwright-core: npm i -D playwright-core'); process.exit(2); }

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8088';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3052';
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

// [candidateId, expected gap in CSS px (the frame renders at 1:1 inside its
// own transform:scale wrapper, so measuring in page coordinates still needs
// dividing out the frame's scale factor, done below), hasFade]
const CANDIDATES = [
  ['now', 0, false],
  ['gap-sm', 8, false],
  ['gap-md', 16, false],
  ['gap-fade', 16, true],
];

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
try {
  for (const w of [1280, 1920]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 1200 }, deviceScaleFactor: 2 });
    await ctx.addCookies([{ name: 'pb_auth', value: cookie, url: APP_URL }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${APP_URL}/dizajn`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="searchgap-section"]', { timeout: 20_000 });
    const at = (s) => `${w}px: ${s}`;

    // Exactly one candidate marked Recommended.
    const recommendedCount = await page.evaluate(() =>
      document.querySelectorAll('[data-testid="searchgap-recommended-badge"]').length,
    );
    check(at('exactly one candidate marked Recommended'), recommendedCount === 1, `${recommendedCount}`);

    for (const [id, gapPx, hasFade] of CANDIDATES) {
      const m = await page.evaluate((wantId) => {
        const section = document.querySelector(`[data-testid="searchgap-section"][data-candidate="${wantId}"]`);
        if (!section) return null;
        const frames = [...section.querySelectorAll('[data-testid="searchgap-frame"]')];
        return {
          frameCount: frames.length,
          fadeCount: section.querySelectorAll('[data-testid="searchgap-fade"]').length,
          gaps: frames.map((frame) => {
            // The pill itself (not its padded wrapper): the wrapper's own
            // padding-bottom IS the gap under test, so measuring from the
            // pill's bottom edge to the first row's top edge is what
            // actually reads out that padding value.
            const pill = frame.querySelector('[data-testid="searchgap-pill"]');
            const firstRow = frame.querySelector('[data-testid="searchgap-first-row"]');
            if (!pill || !firstRow) return null;
            // The frame sits inside a CSS transform:scale() wrapper (ScaledFrame),
            // so raw getBoundingClientRect deltas are scaled too; divide by the
            // frame's own on-screen width ratio against its declared pixel width
            // to recover the gap in the frame's own (unscaled) px.
            const scale = frame.getBoundingClientRect().width / frame.offsetWidth;
            const pillBottom = pill.getBoundingClientRect().bottom;
            const rowTop = firstRow.getBoundingClientRect().top;
            return Math.round((rowTop - pillBottom) / scale);
          }),
        };
      }, id);
      check(at(`${id}: section renders two frames`), !!m && m.frameCount === 2, JSON.stringify(m));
      check(at(`${id}: fade element present iff candidate has one`), !!m && (m.fadeCount > 0) === hasFade, JSON.stringify(m));
      if (m) {
        for (const gap of m.gaps) {
          // 2px tolerance for subpixel rounding through the scale transform.
          check(at(`${id}: measured gap ~= ${gapPx}px`), gap !== null && Math.abs(gap - gapPx) <= 2, `${gap}`);
        }
      }
      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        const section = page.locator(`[data-testid="searchgap-section"][data-candidate="${id}"]`);
        await section.screenshot({ path: path.join(SHOTS, `searchgap-${w}-${id}.png`) }).catch(() => {});
      }
    }

    const overflow = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth }));
    check(at('no horizontal overflow'), overflow.scrollW <= overflow.innerW, `${overflow.scrollW} vs ${overflow.innerW}`);
    check(at('no page errors'), errors.length === 0, errors.join(' | '));

    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `searchgap-${w}-full.png`), fullPage: true });
    await ctx.close();
  }
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
