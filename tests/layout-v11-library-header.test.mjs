/** Bughunt V11: at 360px the Library header's Upload button is cut off.
 *
 *      APP_URL=http://127.0.0.1:3053 PB_URL=http://127.0.0.1:8086 \
 *      ADMIN_USER_EMAIL=strixparalel@gmail.com ADMIN_USER_PASSWORD='EmberTest2026!' \
 *        node tests/layout-v11-library-header.test.mjs
 *
 *  app/(app)/library/page.tsx put the title and the Session / Join / Upload
 *  buttons on one row that could not wrap, so on a narrow phone the buttons
 *  ran past the right edge. Check: at 360 and 375 every header button is
 *  fully inside the page's content box; at 1280 the header is still one
 *  row (title and buttons side by side).
 *
 *  SHOT_DIR=dir saves the 360px header as v11-360.png.
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

/** The header row and its three buttons, against main's content box
 *  (main's box minus its padding). */
const measure = () => {
  const main = document.querySelector('main');
  const title = [...document.querySelectorAll('h1')].find((h) => h.textContent === 'Your library');
  const row = title?.parentElement;
  if (!main || !title || !row) return null;
  const cs = getComputedStyle(main);
  const m = main.getBoundingClientRect();
  const content = {
    left: m.left + parseFloat(cs.paddingLeft),
    right: m.right - parseFloat(cs.paddingRight),
  };
  const buttons = [...row.querySelectorAll('button')].map((b) => {
    const r = b.getBoundingClientRect();
    return { label: b.textContent.trim(), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top) };
  });
  const t = title.getBoundingClientRect();
  return {
    content: { left: Math.round(content.left), right: Math.round(content.right) },
    title: { top: Math.round(t.top), bottom: Math.round(t.bottom) },
    buttons,
    rowOverflow: row.scrollWidth - row.clientWidth,
  };
};

let browser = null;
try {
  browser = await chromium.launch({ executablePath: findChrome(), headless: true });

  const open = async (width, height) => {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    await ctx.addCookies([{ name: 'pb_auth', value: cookieValue, url: APP }]);
    const page = await ctx.newPage();
    await page.goto(`${APP}/library`);
    await page.getByRole('heading', { name: 'Your library' }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(400);
    return { ctx, page };
  };

  for (const [width, height] of [[360, 640], [375, 667]]) {
    const { ctx, page } = await open(width, height);
    const m = await page.evaluate(measure);
    const outside = (m?.buttons ?? []).filter((b) => b.left < m.content.left - 1 || b.right > m.content.right + 1);
    check(
      `${width}px: Session, Join and Upload are all inside the content box`,
      !!m && m.buttons.length === 3 && outside.length === 0,
      JSON.stringify({ content: m?.content, outside }),
    );
    check(`${width}px: the header row does not overflow`, !!m && m.rowOverflow <= 0, `overflow ${m?.rowOverflow}px`);
    if (SHOT_DIR && width === 360) {
      await page.screenshot({ path: path.join(SHOT_DIR, 'v11-360.png'), clip: { x: 0, y: 0, width: 360, height: 240 } });
    }
    await ctx.close();
  }

  // Desktop unchanged: the title and the buttons share one row.
  {
    const { ctx, page } = await open(1280, 800);
    const m = await page.evaluate(measure);
    const upload = m?.buttons.find((b) => b.label === 'Upload');
    const sameRow = !!m && !!upload && upload.top >= m.title.top - 1 && upload.top <= m.title.bottom;
    check('1280px: the buttons stay on the title row', sameRow, JSON.stringify({ title: m?.title, upload }));
    await ctx.close();
  }
} finally {
  if (browser) await browser.close();
}

const failed = out.filter((r) => !r.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
if (failed.length) process.exit(1);
