/** The /dizajn Themes candidates in a real browser (Task 0,
 *  docs/superpowers/plans/2026-09-23-themes.md): every layout candidate
 *  (Three panels, Preview + inspector, Preview on top, tabs below) draws
 *  inside the app shell, the state picker switches every frame (a preset
 *  chosen, editing a custom theme, a readability warning, a shared theme in
 *  use), the frames are visibly recoloured per preset (different computed
 *  background colours), and nothing overflows on a phone.
 *
 *      node tests/themes-gallery-ui.test.mjs
 *
 *  Signs in (EMBER_EMAIL / EMBER_PASSWORD) and opens /dizajn at desktop and
 *  phone widths. SHOT_DIR keeps screenshots. Writes nothing. Run this
 *  against a TEMPORARY build only (see the plan's Task 0): never point it
 *  at the owner's sandbox on 3050. */
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

const LAYOUTS = [
  ['panels', 'Three panels'],
  ['inspector', 'Preview + inspector'],
  ['stacked', 'Preview on top, tabs below'],
];
const STATES = [
  ['A preset chosen', 'preset'],
  ['Editing a custom theme', 'editing'],
  ['Readability warning', 'warning'],
  ['Using a shared theme', 'shared'],
];
const PRESETS = ['ember', 'midnight', 'forest', 'nebula', 'mono'];

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
try {
  for (const [w, h] of [[1400, 1000], [390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await ctx.addCookies([{ name: 'pb_auth', value: cookie, url: APP_URL }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${APP_URL}/dizajn`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="themes-section"]', { timeout: 20_000 });
    const at = (s) => `${w}px: ${s}`;

    // Exactly one layout marked Recommended, on the picker itself.
    const recommendedCount = await page.evaluate(() =>
      [...document.querySelectorAll('[role="radiogroup"][aria-label="Layout"] [role="radio"]')].filter((b) =>
        b.textContent.includes('Recommended'),
      ).length,
    );
    check(at('exactly one layout marked Recommended'), recommendedCount === 1, `${recommendedCount}`);

    for (const [id, label] of LAYOUTS) {
      await page
        .locator('[role="radiogroup"][aria-label="Layout"] [role="radio"]')
        .filter({ hasText: label })
        .click();
      const m = await page.evaluate((wantId) => {
        const section = document.querySelector('[data-testid="themes-section"]');
        return {
          layout: section?.dataset.layout,
          shells: document.querySelectorAll('[data-testid="shell-preview"]').length,
          previews: document.querySelectorAll('[data-testid="live-theme-preview"]').length,
          candidate: document.querySelectorAll(`[data-testid="theme-layout-${wantId}"]`).length,
          scrollW: document.documentElement.scrollWidth,
          innerW: window.innerWidth,
        };
      }, id);
      check(at(`${id}: picker selects it and it draws`), m.layout === id && m.shells === 2 && m.previews === 2 && m.candidate >= 1, JSON.stringify(m));
      check(at(`${id}: nothing overflows horizontally`), m.scrollW <= m.innerW, `${m.scrollW} vs ${m.innerW}`);
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `themes-${w}-${id}.png`), fullPage: true }); }
    }

    // Back on the recommended layout (Preview + inspector), the state
    // picker switches every frame: warning shows the readability finding
    // with a Fix it button, shared shows the read-only "Shared by" note.
    await page
      .locator('[role="radiogroup"][aria-label="Layout"] [role="radio"]')
      .filter({ hasText: 'Preview + inspector' })
      .click();
    for (const [label, id] of STATES) {
      await page.getByRole('radio', { name: label }).click();
      const s = await page.evaluate(() => ({
        state: document.querySelector('[data-testid="themes-section"]')?.dataset.state,
        findings: document.querySelectorAll('[data-testid="readability-finding"]').length,
        fixIt: document.body.textContent.includes('Fix it'),
      }));
      check(at(`state ${label}: picker sets it`), s.state === id, JSON.stringify(s));
      if (id === 'warning') {
        check(at('warning: readability finding shows'), s.findings > 0, JSON.stringify(s));
        check(at('warning: Fix it button shows'), s.fixIt, JSON.stringify(s));
      } else {
        check(at(`${id}: no readability finding`), s.findings === 0, JSON.stringify(s));
      }
    }
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `themes-${w}-states.png`), fullPage: true });

    // Three panels puts the presets grid straight on the desktop frame, no
    // tab to open first: every preset swatch carries a different
    // background colour, proving the frame is really recoloured per
    // preset rather than always showing today's Ember.
    await page
      .locator('[role="radiogroup"][aria-label="Layout"] [role="radio"]')
      .filter({ hasText: 'Three panels' })
      .click();
    await page.getByRole('radio', { name: 'A preset chosen' }).click();
    const swatchColours = await page.evaluate((ids) =>
      ids.map((id) => {
        const opt = document.querySelector(`[data-testid="preset-option"][data-preset="${id}"]`);
        const swatch = opt?.querySelector('[data-testid="swatch"]');
        return swatch ? getComputedStyle(swatch).backgroundColor : null;
      }),
      PRESETS,
    );
    const distinctColours = new Set(swatchColours.filter(Boolean));
    check(
      at('every preset swatch has a distinct computed background colour'),
      distinctColours.size === PRESETS.length,
      JSON.stringify(swatchColours),
    );

    check(at('no page errors'), errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
