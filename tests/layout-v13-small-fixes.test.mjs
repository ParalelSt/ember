/** Bughunt V13: four small fixes.
 *
 *      APP_URL=http://127.0.0.1:3053 PB_URL=http://127.0.0.1:8086 \
 *      ADMIN_USER_EMAIL=strixparalel@gmail.com ADMIN_USER_PASSWORD='EmberTest2026!' \
 *        node tests/layout-v13-small-fixes.test.mjs
 *
 *  1. The add-to-playlist menu cut long playlist names mid-letter: the item
 *     is a flex box, and an ellipsis never shows on a flex box's bare text.
 *     Check: the long name sits in its own box that ends in an ellipsis.
 *  2. Admin "Reset password for <long email>": the title ran under the X.
 *     Check: the title ends left of the X and does not overflow the dialog.
 *  3. The tabs page logged a 404 for /api/tabs/generated when a song has no
 *     generated tab. Check: the route answers 204 (nothing yet), and opening
 *     the tabs page logs no error for it.
 *  4. Admin Tracks listed catalog rows whose upload was deleted, with no
 *     sign they no longer play. Check: those rows say "Missing", a row
 *     whose upload still exists does not, and nothing was deleted.
 *
 *  SHOT_DIR=dir saves v13-menu.png, v13-reset.png and v13-tracks.png.
 *
 *  Needs playwright-core and a Chromium (CHROME_PATH, or the Playwright
 *  cache), and a seeded admin with: a playlist named with 60+ characters, a
 *  user with a 40+ character email, a catalog track "youtube:seed0", and
 *  "upload:" catalog rows, some whose upload record is gone. */
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


const pbGet = (p) => fetch(`${PB}/api/${p}`, { headers: { Authorization: auth.token } }).then((r) => r.json());

let browser = null;
try {
  browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  const newPage = async (width, height) => {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    await ctx.addCookies([{ name: 'pb_auth', value: cookieValue, url: APP }]);
    return { ctx, page: await ctx.newPage() };
  };

  // 1. Add-to-playlist menu, from a playlist's first row, at 390.
  {
    const lists = await pbGet('collections/playlists/records?perPage=50');
    const long = (lists.items ?? []).find((p) => p.name.length >= 60);
    const host = (lists.items ?? []).find((p) => p !== long) ?? long;
    if (!long || !host) {
      check('1. a playlist with a 60+ character name is seeded', false);
    } else {
      const { ctx, page } = await newPage(390, 844);
      await page.goto(`${APP}/playlist/${host.id}`);
      const add = page.getByRole('button', { name: 'Add to playlist' }).first();
      await add.waitFor({ timeout: 30_000 });
      await add.click();
      const item = page.getByRole('menuitem', { name: long.name });
      await item.waitFor({ timeout: 10_000 });
      const m = await item.evaluate((el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let text = walker.nextNode();
        while (text && !text.textContent.trim()) text = walker.nextNode();
        const box = text?.parentElement;
        if (!box) return null;
        const cs = getComputedStyle(box);
        const r = box.getBoundingClientRect();
        const menu = el.closest('[role="menu"]').getBoundingClientRect();
        return {
          textBox: box.tagName.toLowerCase(),
          display: cs.display,
          textOverflow: cs.textOverflow,
          truncated: box.scrollWidth > box.clientWidth,
          insideMenu: r.right <= menu.right + 1,
        };
      });
      check(
        '1. the long playlist name ends in an ellipsis',
        !!m && m.textOverflow === 'ellipsis' && !m.display.includes('flex') && m.truncated && m.insideMenu,
        JSON.stringify(m),
      );
      if (SHOT_DIR) {
        const menu = await page.getByRole('menu').boundingBox();
        await page.screenshot({
          path: path.join(SHOT_DIR, 'v13-menu.png'),
          clip: { x: 0, y: Math.max(0, menu.y - 60), width: 390, height: Math.min(844 - Math.max(0, menu.y - 60), menu.height + 120) },
        });
      }
      await ctx.close();
    }
  }

  // 2. Reset password dialog for the longest email, at 390.
  {
    const { ctx, page } = await newPage(390, 844);
    await page.goto(`${APP}/admin/users`);
    const buttons = page.getByRole('button', { name: /^Reset password for / });
    await buttons.first().waitFor({ timeout: 30_000 });
    const labels = await buttons.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
    const label = labels.sort((a, b) => b.length - a.length)[0];
    const longest = label.slice('Reset password for '.length);
    await page.getByRole('button', { name: label, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ timeout: 10_000 });
    await page.waitForTimeout(300);
    const m = await dialog.evaluate((d) => {
      const title = d.querySelector('[data-slot="dialog-title"]');
      const close = d.querySelector('[data-slot="dialog-close"]');
      if (!title || !close) return null;
      const t = title.getBoundingClientRect();
      const c = close.getBoundingClientRect();
      const box = d.getBoundingClientRect();
      // The first line of the title is the one level with the X.
      const range = document.createRange();
      range.selectNodeContents(title);
      const rightmost = Math.max(...[...range.getClientRects()].filter((r) => r.top < c.bottom).map((r) => r.right));
      return {
        // The text's own box: the title's box minus any right padding.
        titleRight: Math.round(t.right - parseFloat(getComputedStyle(title).paddingRight)),
        firstLineRight: Math.round(rightmost),
        closeLeft: Math.round(c.left),
        dialogRight: Math.round(box.right),
        overflow: title.scrollWidth - title.clientWidth,
      };
    });
    check(
      '2. the reset-password title stays clear of the X',
      !!m && m.firstLineRight <= m.closeLeft && m.titleRight <= m.closeLeft && m.overflow <= 0,
      JSON.stringify({ email: longest, ...m }),
    );
    if (SHOT_DIR) {
      const b = await dialog.boundingBox();
      await page.screenshot({ path: path.join(SHOT_DIR, 'v13-reset.png'), clip: { x: 0, y: b.y - 10, width: 390, height: Math.min(200, b.height + 20) } });
    }
    await ctx.close();
  }

  // 3. The tabs page for a song with no generated tab.
  {
    // An upload the server knows, so the page can name the song without
    // the YouTube lookup.
    const uploads = await fetch(`${APP}/api/uploads`, { headers: { cookie: `pb_auth=${cookieValue}` } }).then((r) => r.json());
    const id = uploads.tracks?.[0]?.id ?? 'upload:none';
    const res = await fetch(`${APP}/api/tabs/generated/${encodeURIComponent(id)}`, { headers: { cookie: `pb_auth=${cookieValue}` } });
    check('3. GET /api/tabs/generated for a song with none answers 204', res.status === 204, `status ${res.status}`);
    const { ctx, page } = await newPage(1280, 800);
    const errors = [];
    const generated = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`${msg.text()} ${msg.location()?.url ?? ''}`);
    });
    page.on('response', (r) => {
      if (r.url().includes('/api/tabs/generated/')) generated.push(r.status());
    });
    await page.goto(`${APP}/tabs/${encodeURIComponent(id)}`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);
    const noisy = errors.filter((e) => e.includes('tabs/generated'));
    check(
      '3. the tabs page asks and logs no error for it',
      generated.length > 0 && generated.every((s) => s < 400) && noisy.length === 0,
      JSON.stringify({ statuses: generated, errors: noisy }),
    );
    await ctx.close();
  }

  // 4. Admin Tracks: catalog rows whose upload is gone.
  {
    // Only the rows the page's first page shows (50 a page, newest first):
    // on a sandbox other suites have filled, older upload rows sit on page 2.
    const firstPage = await pbGet('collections/tracks/records?perPage=50&sort=-created');
    const rows = { totalItems: (await pbGet(`collections/tracks/records?perPage=1&filter=${encodeURIComponent('source="upload"')}`)).totalItems };
    const present = [];
    const gone = [];
    for (const r of (firstPage.items ?? []).filter((t) => t.source === 'upload')) {
      const up = await fetch(`${PB}/api/collections/uploads/records/${r.source_id}`, { headers: { Authorization: auth.token } });
      (up.ok ? present : gone).push(r.title);
    }
    if (!present.length || !gone.length) {
      check('4. an upload row with its upload and one without are seeded', false, JSON.stringify({ present, gone }));
    } else {
      const before = rows.totalItems;
      const { ctx, page } = await newPage(1280, 800);
      await page.goto(`${APP}/admin/tracks`);
      await page.getByText(gone[0], { exact: true }).waitFor({ timeout: 30_000 });
      await page.waitForTimeout(300);
      const marks = await page.evaluate((titles) => {
        const rowOf = (t) => [...document.querySelectorAll('main .truncate.text-sm.font-semibold')].find((el) => el.textContent === t)?.closest('.grid');
        return Object.fromEntries(titles.map((t) => [t, /missing/i.test(rowOf(t)?.textContent ?? '')]));
      }, [...gone, ...present]);
      check('4. rows whose upload is gone say "Missing"', gone.every((t) => marks[t] === true), JSON.stringify(marks));
      check('4. a row whose upload exists does not', present.every((t) => marks[t] === false), JSON.stringify(marks));
      const after = (await pbGet(`collections/tracks/records?perPage=1&filter=${encodeURIComponent('source="upload"')}`)).totalItems;
      check('4. no catalog row was deleted', after === before, `${before} -> ${after}`);
      if (SHOT_DIR) {
        const first = await page.locator('main .grid').first().boundingBox();
        await page.screenshot({ path: path.join(SHOT_DIR, 'v13-tracks.png'), clip: { x: first.x - 10, y: first.y - 60, width: first.width + 20, height: 320 } });
      }
      await ctx.close();
    }
  }
} finally {
  if (browser) await browser.close();
}

const failed = out.filter((r) => !r.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
if (failed.length) process.exit(1);
