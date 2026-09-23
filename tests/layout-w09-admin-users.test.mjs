/** Bughunt W09: Admin > Users unusable at 390px wide.
 *
 *      APP_URL=http://127.0.0.1:3052 PB_URL=http://127.0.0.1:8087 \
 *      ADMIN_USER_EMAIL=strixparalel@gmail.com ADMIN_USER_PASSWORD='EmberTest2026!' \
 *        node tests/layout-w09-admin-users.test.mjs
 *
 *  app/(app)/admin/users/page.tsx used a fixed 6-column grid for every
 *  user row, so below md the columns got squeezed to a few px each: the
 *  email truncated to a sliver and the name input to one character. The
 *  fix stacks the row below md instead. Check: below md the row is no
 *  longer the desktop 6-column grid, and the email text isn't clipped;
 *  at 1280/1920 the row is still the original 6-column grid, unchanged.
 *
 *  Needs playwright-core and a Chromium (CHROME_PATH, or the Playwright
 *  cache), and a seeded admin user (an is_admin user, a few other users so
 *  the list has real rows to check). */
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

const APP = process.env.APP_URL ?? 'http://127.0.0.1:3052';
const PB = process.env.PB_URL ?? 'http://127.0.0.1:8087';
const EMAIL = process.env.ADMIN_USER_EMAIL ?? 'strixparalel@gmail.com';
const PASSWORD = process.env.ADMIN_USER_PASSWORD ?? 'EmberTest2026!';

const out = [];
const check = (name, pass, detail = '') => {
  out.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
};

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

const auth = await fetch(`${PB}/api/collections/users/auth-with-password`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identity: EMAIL, password: PASSWORD }),
}).then((r) => r.json());
if (!auth.token) {
  console.error('Could not authenticate seed admin user against PocketBase:', auth);
  process.exit(2);
}
const cookieValue = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));

let browser = null;
try {
  browser = await chromium.launch({ executablePath: findChrome(), headless: true });

  const newPage = async (width, height) => {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    await ctx.addCookies([{ name: 'pb_auth', value: cookieValue, url: APP }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    return { ctx, page, errors };
  };

  const overflowingEls = (page) =>
    page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const bad = [];
      for (const el of document.body.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > vw + 1) {
          bad.push(`${el.tagName}.${[...el.classList].slice(0, 2).join('.')} right=${Math.round(r.right)} vw=${vw}`);
        }
      }
      return bad;
    });

  // ── 390px: the row must no longer be the desktop 6-column grid, and
  //    the email must not be clipped to a sliver ──
  {
    const { ctx, page, errors } = await newPage(390, 844);
    await page.goto(`${APP}/admin/users`);
    await page.getByText(/^Users ·/).waitFor({ timeout: 30_000 });
    await page.locator('[class*="auto_auto_auto"]').first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(300);
    const bad = await overflowingEls(page);
    check('390px: no element overflows the viewport', bad.length === 0, bad.slice(0, 5).join(' | '));
    check('390px: no page errors', errors.length === 0, errors.join(' | '));
    const info = await page.evaluate(() => {
      const row = document.querySelector('[class*="auto_auto_auto"]');
      const email = row ? row.querySelector('.truncate') : null;
      return {
        cols: row ? getComputedStyle(row).gridTemplateColumns.split(' ').length : 0,
        emailScrollW: email ? email.scrollWidth : null,
        emailClientW: email ? email.clientWidth : null,
      };
    });
    check(
      '390px: row is not squeezed into the 6-column desktop grid',
      info.cols > 0 && info.cols < 6,
      `cols=${info.cols}`,
    );
    check(
      "390px: the email isn't clipped to a sliver",
      info.emailScrollW !== null && info.emailScrollW <= info.emailClientW + 1,
      `scrollWidth=${info.emailScrollW} clientWidth=${info.emailClientW}`,
    );
    await page.screenshot({ path: process.env.W09_SHOT ?? '/tmp/w09.png' });
    await ctx.close();
  }

  // ── Desktop unchanged: still the 6-column grid at 1280 and 1920 ──
  for (const width of [1280, 1920]) {
    const { ctx, page } = await newPage(width, 900);
    await page.goto(`${APP}/admin/users`);
    await page.getByText(/^Users ·/).waitFor({ timeout: 30_000 });
    await page.locator('[class*="auto_auto_auto"]').first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(300);
    const cols = await page.evaluate(() => {
      const row = document.querySelector('[class*="auto_auto_auto"]');
      return row ? getComputedStyle(row).gridTemplateColumns.split(' ').length : 0;
    });
    check(`${width}px: row is still a 6-column grid`, cols === 6, `cols=${cols}`);
    await ctx.close();
  }
} finally {
  if (browser) await browser.close();
}

const failed = out.filter((r) => !r.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
if (failed.length) process.exit(1);
