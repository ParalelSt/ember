/** The /dizajn phone player button-position options: each frame is the real
 *  bar in the mock shell, and each option moves play and next (and the end
 *  of the seek line) as far as it says and nothing else.
 *
 *      node tests/bar-spacing-ui.test.mjs     # or: npm run test:bar-spacing
 *
 *  Signs in (EMBER_EMAIL / EMBER_PASSWORD) and opens /dizajn. SHOT_DIR keeps
 *  a screenshot of the section. Writes nothing. Needs the sandbox from
 *  tests/README.md. */
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

/** Every option's frame in layout px, relative to the bar's own left edge
 *  (offsetLeft chains, so the frame's scale does not matter). */
function measure() {
  const out = {};
  const box = (el, root) => {
    const r = el.getBoundingClientRect(), o = root.getBoundingClientRect();
    const k = root.offsetWidth / o.width;
    return { l: Math.round((r.left - o.left) * k), r: Math.round((r.right - o.left) * k), t: Math.round((r.top - o.top) * k), b: Math.round((r.bottom - o.top) * k), w: Math.round(r.width * k) };
  };
  for (const opt of document.querySelectorAll('[data-testid="barspacing-option"]')) {
    const bar = opt.querySelector('[data-testid="phone-player-bar"]');
    const q = (s) => bar.querySelector(s);
    const play = q('[aria-label="Play"]'), next = q('[aria-label="Next"]');
    out[opt.dataset.option] = {
      barW: bar.offsetWidth,
      barH: bar.closest('footer').offsetHeight,
      art: box(q('.size-art-bar'), bar),
      name: box(q('[data-testid="marquee"]'), bar),
      play: box(play, bar),
      next: box(next, bar),
      nextGlyph: box(q('[data-testid="phone-next-glyph"]'), bar),
      line: box(q('[data-slot="slider-track"]'), bar),
      pageTitle: box(opt.querySelector('h1'), bar),
      look: [q('[data-testid="phone-play-disc"]').offsetWidth, getComputedStyle(q('[data-testid="phone-play-disc"]')).backgroundColor,
        getComputedStyle(q('[data-slot="slider-thumb"]')).borderTopColor, q('.size-art-bar').offsetWidth].join(','),
    };
  }
  return out;
}

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: 'pb_auth', value: cookie, url: APP_URL }]);
  const page = await ctx.newPage();
  await page.goto(`${APP_URL}/dizajn`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="barspacing-section"] [data-testid="phone-player-bar"]', { timeout: 20_000 });
  await page.waitForTimeout(400);
  const m = await page.evaluate(measure);
  const ids = Object.keys(m);
  const show = (o) => `art ${o.art.l}, line ${o.line.l}..${o.line.r}, next glyph ends ${o.nextGlyph.r}, gap art-name ${o.name.l - o.art.r}, play-next ${o.next.l - o.play.r}, bar ${o.barH}px`;
  for (const id of ids) console.log(`       ${id}: ${show(m[id])}`);

  check('five options, as listed',
    JSON.stringify(ids) === JSON.stringify(['aligned', 'left-8', 'left-12', 'left-20', 'left-12-line']), JSON.stringify(ids));
  check('sizes and colours are identical in every option', new Set(ids.map((id) => m[id].look)).size === 1,
    ids.map((id) => m[id].look).join(' | '));
  check('the bar height and the left side never change',
    new Set(ids.map((id) => `${m[id].barH},${m[id].art.l},${m[id].line.l}`)).size === 1,
    ids.map((id) => `${id} ${m[id].barH},${m[id].art.l},${m[id].line.l}`).join(' | '));

  const edge = (o) => o.barW - o.nextGlyph.r;
  const want = { aligned: 16, 'left-8': 24, 'left-12': 28, 'left-20': 36, 'left-12-line': 28 };
  for (const id of ids) {
    check(`${id}: the next icon ends ${want[id]}px from the edge`, edge(m[id]) === want[id], show(m[id]));
  }
  for (const id of ['aligned', 'left-8', 'left-12', 'left-20']) {
    check(`${id}: the line ends under the next icon`, Math.abs(m[id].line.r - m[id].nextGlyph.r) <= 1, show(m[id]));
  }
  const ls = m['left-12-line'];
  check('12px left, line stays: the line keeps 16px on both sides',
    ls.line.l === 16 && ls.barW - ls.line.r === 16, show(ls));
  check('8px left: the icon margin equals the page content margin',
    edge(m['left-8']) === m['left-8'].pageTitle.l, `icon ${edge(m['left-8'])}, page title at ${m['left-8'].pageTitle.l}`);

  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.locator('[data-testid="barspacing-section"]').screenshot({ path: path.join(SHOTS, 'bar-spacing.png') });
  }
  await ctx.close();
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
