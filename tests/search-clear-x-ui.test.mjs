/** The clear X in the search box must not move when pressed.
 *
 *      node tests/search-clear-x-ui.test.mjs      # or: npm run test:search-clear-x-ui
 *
 *  Reported as: the new clear X button "moves down when you click on it".
 *
 *  Root cause: components/ui/button.tsx's shared press feedback,
 *  `active:not-aria-[haspopup]:translate-y-px`, sets the CSS `translate`
 *  property. The clear button is centered with `top-1/2 -translate-y-1/2`,
 *  which ALSO sets `translate`. Both rules have equal selector weight
 *  (one class + one pseudo-class each), so which one wins is a stylesheet
 *  order tie the active rule was winning: pressing the button replaced its
 *  `-50%` centering translate with the press-feedback's `1px` one, so the
 *  icon visibly dropped instead of nudging down by a single pixel. Fixed
 *  in components/search/SearchOverlay.tsx by pinning the clear button's
 *  centering translate with `!` (important) for the `:active` state too,
 *  so centering always wins and the press has no vertical movement left
 *  (only the ghost variant's existing hover/active colour change).
 *
 *  This drives a real Chromium tab, opens search with text in the box (so
 *  the X is showing) on both the desktop dropdown and the phone sheet
 *  (where the X sits in the mic's slot), and measures the button's
 *  getBoundingClientRect() before, mid-mousedown (mid-touchstart on the
 *  phone) and after release. The release is away from the button so the
 *  resulting click never actually fires (a real click would clear the box
 *  and unmount the button, which is a separate, already-tested behaviour
 *  in instant-search-ui.test.mjs), this test is only about whether
 *  pressing moves it. Position and size must hold within 0.5px throughout.
 *
 *  Needs the sandbox from tests/README.md and playwright-core. Set
 *  CHROME_PATH to pick a browser. */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('This test needs playwright-core:\n\n  npm i -D playwright-core\n');
  process.exit(2);
}

const PB = process.env.PB_URL ?? 'http://127.0.0.1:8088';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:3055';
const PASSWORD = 'BugTest2026!';

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

async function adminToken() {
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const r = await fetch(PB + p, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: 'admin@ember.com', password: 'egKa5WNMx3QpuG7' }) });
    if (r.ok) return (await r.json()).token;
  }
  throw new Error('could not authenticate as PB admin');
}

const token = await adminToken();
const email = `search-clear-x-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
const created = await fetch(`${PB}/api/collections/users/records`, { method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: token },
  body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name: 'Clear X Tester', verified: true }) });
if (!created.ok) throw new Error(`could not create test user: ${created.status}`);
const auth = await fetch(`${PB}/api/collections/users/auth-with-password`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PASSWORD }) })
  .then((r) => r.json());
const cookie = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` : ${detail}` : ''}`);
};

/** Presses the clear button (mousedown, or touchstart when `touch`) and
 *  measures its box before, mid-press and after release. Release happens
 *  away from the button so the resulting click never lands on it: a real
 *  click clears the input and unmounts the button, which would make
 *  "after" measure a detached element instead of the same one at rest. */
async function pressAndMeasure(page, clearBtn, touch) {
  const before = await clearBtn.boundingBox();
  const cx = before.x + before.width / 2;
  const cy = before.y + before.height / 2;

  if (touch) {
    await clearBtn.dispatchEvent('touchstart', {
      touches: [{ identifier: 0, clientX: cx, clientY: cy, pageX: cx, pageY: cy }],
      changedTouches: [{ identifier: 0, clientX: cx, clientY: cy, pageX: cx, pageY: cy }],
      targetTouches: [{ identifier: 0, clientX: cx, clientY: cy, pageX: cx, pageY: cy }],
    });
  } else {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
  }
  await page.waitForTimeout(80);
  const during = await clearBtn.boundingBox();

  if (touch) {
    await clearBtn.dispatchEvent('touchend', { touches: [], changedTouches: [], targetTouches: [] });
  } else {
    await page.mouse.move(before.x - 100, before.y - 100);
    await page.mouse.up();
  }
  await page.waitForTimeout(80);
  const after = await clearBtn.boundingBox();

  return { before, during, after };
}

function samePos(a, b, tol = 0.5) {
  return !!a && !!b
    && Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol
    && Math.abs(a.width - b.width) <= tol && Math.abs(a.height - b.height) <= tol;
}

// --- Desktop: the dropdown box, X next to the mic. ---
{
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
  await ctx.addCookies([{ name: 'pb_auth', value: cookie, domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();
  await page.goto(`${APP}/`, { waitUntil: 'networkidle' });
  const input = page.getByPlaceholder('What do you want to listen to?');
  await input.first().click();
  await input.first().fill('harbour');
  await page.waitForTimeout(600);

  const clearBtn = page.getByRole('button', { name: 'Clear search' }).first();
  await clearBtn.waitFor({ timeout: 15000 });
  const { before, during, after } = await pressAndMeasure(page, clearBtn, false);

  check('desktop: X does not move on mousedown',
    samePos(before, during), `before=${JSON.stringify(before)} during=${JSON.stringify(during)}`);
  check('desktop: X is back exactly where it started after release',
    samePos(before, after), `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);

  await ctx.close();
}

// --- Phone: the sheet, X in the mic's slot. ---
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  });
  await ctx.addCookies([{ name: 'pb_auth', value: cookie, domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();
  await page.goto(`${APP}/`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Search' }).first().click();
  await page.locator('[data-slot="dialog-content"]').waitFor({ timeout: 5000 });
  const input = page.getByPlaceholder('What do you want to listen to?');
  await input.fill('harbour');
  await page.waitForTimeout(600);

  const clearBtn = page.getByRole('button', { name: 'Clear search' }).first();
  await clearBtn.waitFor({ timeout: 15000 });

  const mouseResult = await pressAndMeasure(page, clearBtn, false);
  check('phone: X does not move on mousedown',
    samePos(mouseResult.before, mouseResult.during),
    `before=${JSON.stringify(mouseResult.before)} during=${JSON.stringify(mouseResult.during)}`);

  const touchResult = await pressAndMeasure(page, clearBtn, true);
  check('phone: X does not move on touchstart',
    samePos(touchResult.before, touchResult.during),
    `before=${JSON.stringify(touchResult.before)} during=${JSON.stringify(touchResult.during)}`);
  check('phone: X is back exactly where it started after touchend',
    samePos(touchResult.before, touchResult.after),
    `before=${JSON.stringify(touchResult.before)} after=${JSON.stringify(touchResult.after)}`);

  await ctx.close();
}

await browser.close();

const failed = checks.filter(([, p]) => !p);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map(([n]) => n).join(', '));
process.exit(failed.length ? 1 : 0);
