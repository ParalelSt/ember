/** Bughunt W11: at 390px the Plugins and Help settings tabs are off-screen
 *  with nothing showing the row scrolls.
 *
 *      APP_URL=http://127.0.0.1:3052 PB_URL=http://127.0.0.1:8087 \
 *      ADMIN_USER_EMAIL=strixparalel@gmail.com ADMIN_USER_PASSWORD='EmberTest2026!' \
 *        node tests/layout-w11-settings-tabs.test.mjs
 *
 *  components/settings/SettingsTabs.tsx rendered the tab row as a plain
 *  horizontal scroller below md: nothing scrolled the active tab into
 *  view on landing (a direct link to /settings/help left it off-screen)
 *  and nothing hinted the row could be scrolled at all. Fix: scroll the
 *  active tab into view on mount/navigation, and add edge fades (theme
 *  tokens, not raw colours) below md. Check: the active tab's bounding
 *  box is fully inside the scroller's visible box at 390px; the tab list
 *  is still a plain vertical column (no scroller, no fade) at 1280/1920.
 *
 *  Needs playwright-core and a Chromium (CHROME_PATH, or the Playwright
 *  cache), and a seeded, logged-in user (any role). */
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
  console.error('Could not authenticate seed user against PocketBase:', auth);
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

  // ── 390px: landing directly on /settings/help, the Help tab (active)
  //    must be fully inside the scroller's visible box with no manual
  //    scrolling ──
  {
    const { ctx, page, errors } = await newPage(390, 844);
    await page.goto(`${APP}/settings/help`);
    await page.getByRole('heading', { name: 'Help' }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(300);
    const inView = await page.evaluate(() => {
      const link = document.querySelector('a[href="/settings/help"]');
      const scroller = link ? link.closest('ul') : null;
      if (!link || !scroller) return null;
      const l = link.getBoundingClientRect();
      const s = scroller.getBoundingClientRect();
      return { linkLeft: l.left, linkRight: l.right, scrollerLeft: s.left, scrollerRight: s.right };
    });
    const fits =
      !!inView && inView.linkLeft >= inView.scrollerLeft - 1 && inView.linkRight <= inView.scrollerRight + 1;
    check('390px: active tab (Help) is inside the visible scroll area', fits, JSON.stringify(inView));
    check('390px: no page errors', errors.length === 0, errors.join(' | '));
    await page.screenshot({ path: process.env.W11_SHOT ?? '/tmp/w11.png' });
    await ctx.close();
  }

  // ── Same check landing on /settings/plugins (the other tab the finder
  //    reported as off-screen) ──
  {
    const { ctx, page } = await newPage(390, 844);
    await page.goto(`${APP}/settings/plugins`);
    await page.getByRole('heading', { name: 'Plugins' }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(300);
    const inView = await page.evaluate(() => {
      const link = document.querySelector('a[href="/settings/plugins"]');
      const scroller = link ? link.closest('ul') : null;
      if (!link || !scroller) return null;
      const l = link.getBoundingClientRect();
      const s = scroller.getBoundingClientRect();
      return { linkLeft: l.left, linkRight: l.right, scrollerLeft: s.left, scrollerRight: s.right };
    });
    const fits =
      !!inView && inView.linkLeft >= inView.scrollerLeft - 1 && inView.linkRight <= inView.scrollerRight + 1;
    check('390px: active tab (Plugins) is inside the visible scroll area', fits, JSON.stringify(inView));
    await ctx.close();
  }

  // ── Desktop unchanged: still a plain vertical column at 1280/1920 ──
  for (const width of [1280, 1920]) {
    const { ctx, page } = await newPage(width, 900);
    await page.goto(`${APP}/settings/help`);
    await page.getByRole('heading', { name: 'Help' }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(300);
    const flexDir = await page.evaluate(() => {
      const ul = document.querySelector('nav ul');
      return ul ? getComputedStyle(ul).flexDirection : null;
    });
    check(`${width}px: tab list is still a vertical column`, flexDir === 'column', `flexDirection=${flexDir}`);
    await ctx.close();
  }
} finally {
  if (browser) await browser.close();
}

const failed = out.filter((r) => !r.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
if (failed.length) process.exit(1);
