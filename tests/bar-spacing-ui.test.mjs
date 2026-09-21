/** The /dizajn phone player spacing options: each frame is the real bar in
 *  the mock shell, and each option moves the edges it says it does and
 *  nothing else (sizes and colours measure the same in every frame).
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

  check('five options, as listed', JSON.stringify(ids) === JSON.stringify(['now', 'aligned', 'roomy', 'compact', 'edge']), JSON.stringify(ids));
  check('sizes and colours are identical in every option', new Set(ids.map((id) => m[id].look)).size === 1,
    ids.map((id) => m[id].look).join(' | '));

  const { now, aligned, roomy, compact, edge } = m;
  check('As it is: neither end of the line lines up (the problem)',
    now.line.l !== now.art.l && now.line.r !== now.nextGlyph.r, show(now));
  for (const [id, o] of [['Aligned', aligned], ['Roomy', roomy], ['Compact', compact]]) {
    check(`${id}: the line starts under the artwork and ends under the next icon`,
      Math.abs(o.line.l - o.art.l) <= 1 && Math.abs(o.line.r - o.nextGlyph.r) <= 1, show(o));
  }
  check('Aligned: same height and gaps as now', aligned.barH === now.barH
    && aligned.name.l - aligned.art.r === now.name.l - now.art.r, show(aligned));
  check('Roomy: bigger gaps and a taller bar', roomy.barH > now.barH
    && roomy.name.l - roomy.art.r > now.name.l - now.art.r && roomy.next.l - roomy.play.r > now.next.l - now.play.r, show(roomy));
  check('Compact: a shorter bar', compact.barH < now.barH, show(compact));
  check('Edge to edge: the line spans the full width, the next icon lines up with the art margin',
    edge.line.l === 0 && edge.line.r === edge.barW && edge.barW - edge.nextGlyph.r === edge.art.l, show(edge));

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
