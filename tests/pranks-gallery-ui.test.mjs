/** The /dizajn Pranks candidates in a real browser (Task 0,
 *  docs/superpowers/plans/2026-09-23-admin-pranks.md): every candidate
 *  (Control room, Card per person, Two-step wizard) draws inside the app
 *  shell, the state picker switches every frame (idle, someone listening,
 *  a repeat running, off switch on), and nothing overflows on a phone.
 *
 *      node tests/pranks-gallery-ui.test.mjs
 *
 *  Signs in (EMBER_EMAIL / EMBER_PASSWORD) and opens /dizajn at desktop and
 *  phone widths. SHOT_DIR keeps screenshots. Writes nothing. Needs the
 *  sandbox from tests/README.md; APP_URL/PB_URL override the default
 *  sandbox ports for a temporary build (see the plan's Task 0). */
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

const CANDIDATES = ['control-room', 'card-per-person', 'wizard'];
const STATES = [
  ['Idle', 'idle'],
  ['Someone listening', 'listening'],
  ['Repeat running', 'repeat'],
  ['Off switch on', 'off'],
];

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
try {
  for (const [w, h] of [[1400, 1000], [390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await ctx.addCookies([{ name: 'pb_auth', value: cookie, url: APP_URL }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${APP_URL}/dizajn`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="pranks-section"]', { timeout: 20_000 });
    const at = (s) => `${w}px: ${s}`;

    // Exactly one candidate is marked Recommended, on the picker itself.
    const recommendedCount = await page.evaluate(() =>
      [...document.querySelectorAll('[role="radiogroup"][aria-label="Candidate"] [role="radio"]')].filter((b) =>
        b.textContent.includes('Recommended'),
      ).length,
    );
    check(at('exactly one candidate marked Recommended'), recommendedCount === 1, `${recommendedCount}`);

    for (const id of CANDIDATES) {
      await page
        .locator('[role="radiogroup"][aria-label="Candidate"] [role="radio"]')
        .filter({ hasText: id === 'control-room' ? 'Control room' : id === 'card-per-person' ? 'Card per person' : 'Two-step wizard' })
        .click();
      const m = await page.evaluate((wantId) => {
        const section = document.querySelector('[data-testid="pranks-section"]');
        return {
          option: section?.dataset.option,
          shells: document.querySelectorAll('[data-testid="shell-preview"]').length,
          candidate: document.querySelectorAll(`[data-testid="prank-candidate-${wantId}"]`).length,
          scrollW: document.documentElement.scrollWidth,
          innerW: window.innerWidth,
        };
      }, id);
      check(at(`${id}: picker selects it and it draws`), m.option === id && m.shells === 2 && m.candidate >= 1, JSON.stringify(m));
      check(at(`${id}: nothing overflows horizontally`), m.scrollW <= m.innerW, `${m.scrollW} vs ${m.innerW}`);
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `pranks-${w}-${id}.png`), fullPage: true }); }
    }

    // Back on the recommended candidate (Control room), the state picker
    // switches every frame: idle has no schedule banner, listening shows a
    // plain-words person line, repeat shows the schedule banner and Stop,
    // off turns the global switch off and disables Send.
    await page
      .locator('[role="radiogroup"][aria-label="Candidate"] [role="radio"]')
      .filter({ hasText: 'Control room' })
      .click();
    for (const [label, id] of STATES) {
      await page.getByRole('radio', { name: label }).click();
      const s = await page.evaluate(() => ({
        state: document.querySelector('[data-testid="pranks-section"]')?.dataset.state,
        schedule: document.querySelectorAll('[data-testid="prank-schedule-banner"]').length,
        switchOn: document.querySelector('[data-testid="prank-global-switch"] [role="switch"]')?.getAttribute('aria-checked'),
        personLine: document.body.textContent.includes("Luka is listening to Beggin'"),
      }));
      check(at(`state ${label}: picker sets it`), s.state === id, JSON.stringify(s));
      if (id === 'repeat') check(at('repeat: schedule banner shows'), s.schedule > 0, JSON.stringify(s));
      if (id === 'off') check(at('off: global switch reads off'), s.switchOn === 'false', JSON.stringify(s));
      if (id === 'listening') check(at('listening: plain-words person line shows'), s.personLine, JSON.stringify(s));
    }
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `pranks-${w}-states.png`), fullPage: true });

    check(at('no page errors'), errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
