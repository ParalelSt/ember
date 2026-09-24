/** The /dizajn Playlist copy candidates in a real browser (Task 0,
 *  docs/superpowers/plans/2026-09-24-playlist-copy.md): every candidate
 *  (Checkbox column, Tap to select, Copy songs dialog) draws inside the app
 *  shell at 1280 and 390, the step picker puts both frames at every step of
 *  the flow, the recommended one clicks through from the page to a result,
 *  and nothing overflows on a phone.
 *
 *      node tests/playlist-copy-gallery-ui.test.mjs
 *
 *  Signs in (EMBER_EMAIL / EMBER_PASSWORD) and opens /dizajn at a wide
 *  desktop (so the 1280 frame draws at 1:1) and at 390. SHOT_DIR keeps
 *  cropped JPEGs of each candidate's frames at the select, Liked warning
 *  and result steps, at deviceScaleFactor 1. Writes nothing to the app.
 *  Needs the sandbox from tests/README.md; APP_URL/PB_URL override the
 *  default sandbox ports for a temporary build. */
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

const CANDIDATES = [
  ['checkbox-bar', 'Checkbox column'],
  ['tap-select', 'Tap to select'],
  ['copy-dialog', 'Copy songs dialog'],
];
const STEPS = [
  ['start', 'The page'],
  ['select', 'Select one by one'],
  ['all', 'Select all'],
  ['sort', 'Sort'],
  ['picker', 'Copy to…'],
  ['liked', 'Liked songs warning'],
  ['result', 'Result'],
];
const SHOT_STEPS = { select: 'select', liked: 'liked', result: 'result' };

const radio = (page, group, name) =>
  page.locator(`[role="radiogroup"][aria-label="${group}"] [role="radio"]`).filter({ hasText: name }).first();

/** What each frame shows at the step, read from both shells. */
async function readFrames(page) {
  return page.evaluate(() => {
    const section = document.querySelector('[data-testid="playlist-copy-section"]');
    const shells = [...document.querySelectorAll('[data-testid="shell-preview"]')];
    return {
      option: section?.dataset.option,
      step: section?.dataset.step,
      phones: shells.map((s) => s.dataset.phone),
      frames: shells.map((s) => {
        const rows = [...s.querySelectorAll('[data-testid="copy-row"]')];
        return {
          candidate: s.querySelector('[data-testid^="copy-candidate-"]')?.dataset.testid ?? null,
          rows: rows.length,
          selected: rows.filter((r) => r.dataset.selected === 'true').length,
          sortMenu: !!s.querySelector('[data-testid="copy-sort-menu"]'),
          destinations: [...s.querySelectorAll('[data-testid="copy-destination"]')].map((d) => d.dataset.destination),
          liked: s.querySelector('[data-testid="copy-liked-confirm"]')?.textContent ?? '',
          result: s.querySelector('[data-testid="copy-result-line"]')?.textContent ?? '',
        };
      }),
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    };
  });
}

function stepOk(step, f) {
  switch (step) {
    case 'start': return f.selected === 0 && !f.liked && !f.result;
    case 'select': return f.selected === 3;
    case 'all': return f.selected === 15;
    case 'sort': return f.sortMenu;
    case 'picker': return f.destinations.join(',') === 'new,liked,gym,sunday,dad,alt';
    case 'liked': return /likes every one of them/.test(f.liked) && /3 are already liked/.test(f.liked);
    case 'result': return f.result === 'Added 12, skipped 3 already there';
  }
  return false;
}

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
try {
  for (const [w, h] of [[1760, 1100], [390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await ctx.addCookies([{ name: 'pb_auth', value: cookie, url: APP_URL }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${APP_URL}/dizajn`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="playlist-copy-section"]', { timeout: 20_000 });
    const at = (s) => `${w}px: ${s}`;

    const recommended = await page.evaluate(() =>
      [...document.querySelectorAll('[role="radiogroup"][aria-label="Candidate"] [role="radio"]')]
        .filter((b) => b.textContent.includes('Recommended'))
        .map((b) => b.textContent.replace('Recommended', '').trim()),
    );
    check(at('exactly one candidate marked Recommended (Checkbox column)'), recommended.length === 1 && recommended[0] === 'Checkbox column', JSON.stringify(recommended));

    for (const [id, name] of CANDIDATES) {
      await radio(page, 'Candidate', name).click();
      for (const [step, label] of STEPS) {
        await radio(page, 'Step', label).click();
        await page.waitForTimeout(80);
        const m = await readFrames(page);
        const drawn = m.option === id && m.step === step && m.phones.join() === 'false,true'
          && m.frames.every((f) => f.candidate === `copy-candidate-${id}`);
        check(at(`${id} / ${step}: both frames draw the candidate at the step`), drawn && m.frames.every((f) => stepOk(step, f)), JSON.stringify(m.frames));
        check(at(`${id} / ${step}: nothing overflows horizontally`), m.scrollW <= m.innerW, `${m.scrollW} vs ${m.innerW}`);

        if (SHOTS && w > 1000 && SHOT_STEPS[step]) {
          fs.mkdirSync(SHOTS, { recursive: true });
          for (const [frame, size] of [['desktop', 1280], ['phone', 390]]) {
            // The frame box itself (its 1px border included), not the shell
            // inside it: that is the 1280 or 390 the frame stands for.
            const shell = page.locator(`[data-testid="copy-frame-${frame}"] [data-testid="shell-preview"]`).locator('..');
            const box = await shell.boundingBox();
            check(at(`${id} / ${step}: the ${size} frame draws 1:1 for the screenshot`), !!box && Math.round(box.width) === size, `${box?.width}`);
            await shell.screenshot({ path: path.join(SHOTS, `${id}-${step}-${size}.jpg`), type: 'jpeg', quality: 78 });
          }
        }
      }
    }

    // The recommended candidate, clicked through in the desktop frame from
    // the page: Select, one song, Select all, clear, all again, sort by
    // title Z to A, Copy to Gym (2 already there).
    await radio(page, 'Candidate', 'Checkbox column').click();
    await radio(page, 'Step', 'The page').click();
    const desk = page.locator('[data-testid="copy-frame-desktop"] [data-testid="shell-preview"]');
    await desk.locator('[data-testid="copy-enter"]').click();
    await desk.locator('[data-testid="copy-row"]').nth(1).click();
    const picked = () => desk.locator('[data-testid="copy-row"][data-selected="true"]').count();
    check(at('click-through: one song picked'), (await picked()) === 1);
    await desk.locator('[data-testid="copy-select-all"]').click();
    check(at('click-through: Select all picks 15'), (await picked()) === 15);
    await desk.locator('[data-testid="copy-select-all"]').click();
    check(at('click-through: Clear all picks none'), (await picked()) === 0);
    await desk.locator('[data-testid="copy-select-all"]').click();
    await desk.locator('[data-testid="copy-sort"]').click();
    await desk.getByRole('button', { name: 'Title, Z to A' }).click();
    const first = await desk.locator('[data-testid="copy-row"]').first().textContent();
    check(at('click-through: sorted by title, Z to A'), first.startsWith('Звезда'), first);
    await desk.locator('[data-testid="copy-to"]').click();
    await desk.locator('[data-testid="copy-destination"][data-destination="gym"]').click();
    const line = await desk.locator('[data-testid="copy-result-line"]').textContent();
    check(at('click-through: copied into Gym'), line === 'Added 13, skipped 2 already there', line);

    check(at('no page errors'), errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
