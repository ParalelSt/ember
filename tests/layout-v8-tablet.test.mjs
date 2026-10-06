/** Bughunt V8: tablet (768px) layouts are squeezed.
 *
 *      APP_URL=http://127.0.0.1:3053 PB_URL=http://127.0.0.1:8086 \
 *      ADMIN_USER_EMAIL=strixparalel@gmail.com ADMIN_USER_PASSWORD='EmberTest2026!' \
 *        node tests/layout-v8-tablet.test.mjs
 *
 *  Home shelves picked their column count from the WINDOW width
 *  (lib/layout.ts), so at 768 they drew 5 cards across the ~460px left
 *  after the sidebar. Settings and Admin switched to their side nav at md,
 *  which left ~230px for the page itself (Admin Tracks titles one letter
 *  wide, the Appearance preview clipped). Fix: shelves size their columns
 *  from the width they actually get; the side navs start at lg, with the
 *  top tab row below that. Checks, at 768: shelf cards at least 120px wide,
 *  the settings and admin tabs in a row over the page, the page at least
 *  400px wide, an Admin Tracks title at least 120px wide. At 390 and 1280
 *  the layout is today's: 2 and 6 cards a row (4 with the lyrics panel open
 *  at 1280), tabs in a row at 390 and a side column at 1280.
 *
 *  SHOT_DIR=dir saves full-page shots (v8-<page>-<width>.png) at 390, 768
 *  and 1280.
 *
 *  Needs playwright-core and a Chromium (CHROME_PATH, or the Playwright
 *  cache), and a seeded admin with 12 or more liked songs and some tracks. */
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

const APP = process.env.APP_URL ?? 'http://127.0.0.1:3053';
const PB = process.env.PB_URL ?? 'http://127.0.0.1:8086';
const EMAIL = process.env.ADMIN_USER_EMAIL ?? 'strixparalel@gmail.com';
const PASSWORD = process.env.ADMIN_USER_PASSWORD ?? 'EmberTest2026!';
const SHOT_DIR = process.env.SHOT_DIR;

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


/** Cards on the first shelf's first row, and their width. */
const shelf = () => {
  const list = document.querySelector('main section [role="list"]');
  if (!list) return null;
  const items = [...list.querySelectorAll(':scope > [role="listitem"]')].map((el) => el.getBoundingClientRect());
  if (!items.length) return null;
  const top = items[0].top;
  const row = items.filter((r) => Math.abs(r.top - top) < 2);
  return { perRow: row.length, cardWidth: Math.round(row[0].width), listWidth: Math.round(list.getBoundingClientRect().width) };
};

/** The settings/admin tab list's direction and the page column's width. */
const tabs = () => {
  const ul = document.querySelector('main nav ul');
  const nav = ul?.closest('nav');
  const pageCol = nav?.nextElementSibling;
  if (!ul || !pageCol) return null;
  return {
    direction: getComputedStyle(ul).flexDirection,
    pageWidth: Math.round(pageCol.getBoundingClientRect().width),
    pageLeft: Math.round(pageCol.getBoundingClientRect().left),
  };
};

/** The first Admin Tracks row's title cell. */
const trackTitle = () => {
  const cell = [...document.querySelectorAll('main .truncate.text-sm.font-semibold')][0];
  return cell ? Math.round(cell.getBoundingClientRect().width) : null;
};

let browser = null;
try {
  browser = await chromium.launch({ executablePath: findChrome(), headless: true });

  const open = async (width, pathname, ready, { lyrics = false } = {}) => {
    const ctx = await browser.newContext({ viewport: { width, height: width === 768 ? 1024 : width === 390 ? 844 : 800 }, deviceScaleFactor: 1 });
    await ctx.addCookies([{ name: 'pb_auth', value: cookieValue, url: APP }]);
    if (lyrics) {
      // The desktop lyrics panel, open from the persisted UI store.
      await ctx.addInitScript(() => {
        try {
          localStorage.setItem('ember.ui.v1', JSON.stringify({ state: { lyricsOpen: true }, version: 0 }));
        } catch {}
      });
    }
    const page = await ctx.newPage();
    await page.goto(`${APP}${pathname}`);
    await ready(page);
    await page.waitForTimeout(800);
    return { ctx, page };
  };
  const shot = async (page, name, width) => {
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `v8-${name}-${width}.png`) });
  };
  const homeReady = (page) => page.locator('main section [role="listitem"]').first().waitFor({ timeout: 30_000 });
  const tabsReady = (name) => (page) => page.getByRole('heading', { name, exact: true }).first().waitFor({ timeout: 30_000 });
  const tracksReady = (page) => page.locator('main .truncate.text-sm.font-semibold').first().waitFor({ timeout: 30_000 });

  const expectPerRow = { 390: 2, 1280: 6 };
  for (const width of [390, 768, 1280]) {
    {
      const { ctx, page } = await open(width, '/', homeReady);
      const m = await page.evaluate(shelf);
      if (width === 768) {
        check('768px Home: shelf cards are at least 120px wide', !!m && m.cardWidth >= 120, JSON.stringify(m));
      } else {
        check(`${width}px Home: ${expectPerRow[width]} cards a row, as before`, m?.perRow === expectPerRow[width], JSON.stringify(m));
      }
      await shot(page, 'home', width);
      await ctx.close();
    }
    if (width === 1280) {
      const { ctx, page } = await open(width, '/', homeReady, { lyrics: true });
      const m = await page.evaluate(shelf);
      check('1280px Home with the lyrics panel open: 4 cards a row, as before', m?.perRow === 4, JSON.stringify(m));
      await shot(page, 'home-lyrics', width);
      await ctx.close();
    }
    for (const [name, pathname, ready] of [
      ['appearance', '/settings/appearance', tabsReady('Settings')],
      ['admin-tracks', '/admin/tracks', tracksReady],
    ]) {
      const { ctx, page } = await open(width, pathname, ready);
      const m = await page.evaluate(tabs);
      if (width === 1280) {
        check(`1280px ${name}: tabs are a side column, as before`, m?.direction === 'column', JSON.stringify(m));
      } else {
        check(`${width}px ${name}: tabs are a row above the page`, m?.direction === 'row', JSON.stringify(m));
      }
      if (width === 768) {
        check(`768px ${name}: the page column is at least 400px wide`, !!m && m.pageWidth >= 400, JSON.stringify(m));
      }
      if (width === 768 && name === 'admin-tracks') {
        const w = await page.evaluate(trackTitle);
        check('768px admin-tracks: a track title has at least 120px', (w ?? 0) >= 120, `title width ${w}`);
      }
      await shot(page, name, width);
      await ctx.close();
    }
  }
} finally {
  if (browser) await browser.close();
}

const failed = out.filter((r) => !r.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
if (failed.length) process.exit(1);
