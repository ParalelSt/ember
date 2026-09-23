/** Bughunt W10: long playlist names run off the page.
 *
 *      APP_URL=http://127.0.0.1:3052 PB_URL=http://127.0.0.1:8087 \
 *      ADMIN_USER_EMAIL=strixparalel@gmail.com ADMIN_USER_PASSWORD='EmberTest2026!' \
 *      LONG_PLAYLIST_NAME='...' \
 *        node tests/layout-w10-playlist-header.test.mjs
 *
 *  components/page/CollectionHeader.tsx:94 rendered the title in an h1
 *  with no break-words and no min-w-0 on its flex column, so one long
 *  unbroken word (no spaces to wrap at) pushed the box past the page's
 *  right edge instead of wrapping. Check: no element overflows the
 *  viewport at 1280/390/1920 with a very long playlist name, and the
 *  title wraps onto a capped number of lines (not literally infinite) at
 *  390px.
 *
 *  Needs playwright-core and a Chromium (CHROME_PATH, or the Playwright
 *  cache), and a playlist owned by the seed user with a very long,
 *  unbroken name. */
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
const LONG_NAME =
  process.env.LONG_PLAYLIST_NAME ??
  'BUGHUNT Supercalifragilisticexpialidocious_playlist_with_an_extremely_long_name_that_should_wrap_and_not_run_off_the_page_1280_390';

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

let playlistId = process.env.LONG_PLAYLIST_ID ?? null;
if (!playlistId) {
  const list = await fetch(
    `${PB}/api/collections/playlists/records?filter=${encodeURIComponent(`user="${auth.record.id}"`)}`,
    { headers: { Authorization: auth.token } },
  ).then((r) => r.json());
  const hit = (list.items ?? []).find((p) => p.name === LONG_NAME) ?? (list.items ?? [])[0];
  playlistId = hit?.id ?? null;
}
if (!playlistId) {
  console.error('No playlist found to check against; seed one with a very long name first.');
  process.exit(2);
}

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

  for (const width of [1280, 390, 1920]) {
    const { ctx, page, errors } = await newPage(width, 900);
    await page.goto(`${APP}/playlist/${playlistId}`);
    await page.locator('[data-testid="collection-header"]').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(300);
    const bad = await overflowingEls(page);
    check(`${width}px: no element overflows the viewport`, bad.length === 0, bad.slice(0, 5).join(' | '));
    check(`${width}px: no page errors`, errors.length === 0, errors.join(' | '));
    if (width === 390) {
      const h1 = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="collection-header"] h1');
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { lineHeight: parseFloat(cs.lineHeight), height: el.getBoundingClientRect().height };
      });
      const lines = h1 ? Math.round(h1.height / h1.lineHeight) : 0;
      check('390px: long title wraps onto a capped number of lines (2-3)', !!h1 && lines >= 2 && lines <= 3, `lines=${lines}`);
      await page.screenshot({ path: process.env.W10_SHOT_390 ?? '/tmp/w10-390.png' });
    }
    if (width === 1280) {
      await page.screenshot({ path: process.env.W10_SHOT_1280 ?? '/tmp/w10-1280.png' });
    }
    await ctx.close();
  }
} finally {
  if (browser) await browser.close();
}

const failed = out.filter((r) => !r.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
if (failed.length) process.exit(1);
