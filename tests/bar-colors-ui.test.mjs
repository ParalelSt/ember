/** The /dizajn phone player colour options: each frame is the real bar in
 *  the mock shell, and each option changes the colours it says it does and
 *  nothing else (the layout measures the same in every frame).
 *
 *      node tests/bar-colors-ui.test.mjs     # or: npm run test:bar-colors
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

/** The computed colours in every option's frame: the seek fill and dot, the
 *  play disc and its glyph, and the nav's active item, plus the layout
 *  numbers that must NOT change between options. */
function measure() {
  const out = {};
  for (const opt of document.querySelectorAll('[data-testid="barcolors-option"]')) {
    const q = (s) => opt.querySelector(s);
    const cs = (s) => { const el = q(s); return el ? getComputedStyle(el) : null; };
    const disc = q('[data-testid="phone-play-disc"]');
    const bar = q('[data-testid="phone-player-bar"]');
    out[opt.dataset.option] = {
      fill: cs('[data-slot="slider-range"]')?.backgroundColor,
      dotBg: cs('[data-slot="slider-thumb"]')?.backgroundColor,
      dotBorder: cs('[data-slot="slider-thumb"]')?.borderTopColor,
      dotOpacity: cs('[data-slot="slider-thumb"]')?.opacity,
      disc: disc ? getComputedStyle(disc).backgroundColor : null,
      glyph: disc ? getComputedStyle(disc).color : null,
      navActive: cs('[data-testid="mock-mobile-nav"] .text-foreground')?.color,
      layout: bar ? [bar.offsetHeight, disc.offsetWidth, ...[...bar.querySelectorAll('button')].map((b) => `${b.getAttribute('aria-label')}:${b.offsetWidth}`)].join(',') : null,
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
  await page.waitForSelector('[data-testid="barcolors-section"] [data-testid="phone-player-bar"]', { timeout: 20_000 });
  await page.waitForTimeout(400);
  const m = await page.evaluate(measure);
  const ids = Object.keys(m);

  check('five options, as listed', JSON.stringify(ids) === JSON.stringify(['now', 'mono', 'ember-line', 'ember-play', 'quiet']), JSON.stringify(ids));
  check('the old gallery sections are gone from /dizajn',
    await page.locator('[data-testid="mobileplayer-section"], [role="radiogroup"]').count() === 0);
  check('the layout is identical in every option',
    new Set(ids.map((id) => m[id].layout)).size === 1, ids.map((id) => `${id} ${m[id].layout}`).join(' | '));

  const { now, mono } = m;
  const line = m['ember-line'];
  const play = m['ember-play'];
  const quiet = m.quiet;
  check('As it is: the dot has the red ring, everything else white',
    now.dotBorder !== now.fill && now.disc === now.fill, JSON.stringify(now));
  check('All white: the ring matches the white line',
    mono.dotBorder === mono.fill && mono.dotBorder === now.fill, JSON.stringify(mono));
  check('Ember line: line, dot and active tab are the red; play stays white',
    line.fill === now.dotBorder && line.dotBg === now.dotBorder && line.navActive === now.dotBorder && line.disc === now.disc,
    JSON.stringify(line));
  check('Ember play: the disc turns red too, with a white glyph',
    play.disc === now.dotBorder && play.fill === now.dotBorder && play.glyph === now.fill, JSON.stringify(play));
  check('Quiet: the dot hides, the disc goes soft grey with a white glyph',
    quiet.dotOpacity === '0' && quiet.disc !== now.disc && quiet.glyph === now.fill, JSON.stringify(quiet));

  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.locator('[data-testid="barcolors-section"]').screenshot({ path: path.join(SHOTS, 'bar-colors.png') });
  }
  await ctx.close();
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
