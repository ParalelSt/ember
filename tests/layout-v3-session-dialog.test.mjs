/** Bughunt V3: the "Start a session" dialog overflows with a long playlist name.
 *
 *      APP_URL=http://127.0.0.1:3052 PB_URL=http://127.0.0.1:8087 \
 *      ADMIN_USER_EMAIL=strixparalel@gmail.com ADMIN_USER_PASSWORD='EmberTest2026!' \
 *        node tests/layout-v3-session-dialog.test.mjs
 *
 *  components/session/SessionDialogs.tsx: the "Seed from playlist" select
 *  sized itself to its longest option, and nothing in the dialog let it
 *  shrink, so one long playlist name pushed the name box, the select and
 *  the Go live button past the dialog's right edge (and off a phone).
 *  Check at 390 and 1280: the dialog does not scroll sideways, and the
 *  name box, the select and Go live all sit inside it.
 *
 *  Needs playwright-core and a Chromium (CHROME_PATH, or the Playwright
 *  cache), and a playlist of the seed user's with a long name (40+ chars).
 *  SHOT_DIR + SHOT_TAG save a cropped dialog per width. */
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
const SHOT_DIR = process.env.SHOT_DIR ?? '';
const SHOT_TAG = process.env.SHOT_TAG ?? 'V3';

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
  console.error('Could not authenticate the seed user against PocketBase:', auth);
  process.exit(2);
}
const lists = await fetch(
  `${PB}/api/collections/playlists/records?perPage=200&filter=${encodeURIComponent(`user="${auth.record.id}"`)}`,
  { headers: { Authorization: auth.token } },
).then((r) => r.json());
if (!(lists.items ?? []).some((p) => p.name.length >= 40)) {
  console.error('Seed a playlist with a long name (40+ characters) for the seed user first.');
  process.exit(2);
}
const cookieValue = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));

let browser = null;
try {
  browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  for (const width of [390, 1280]) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
    await ctx.addCookies([{ name: 'pb_auth', value: cookieValue, url: APP }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${APP}/library`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Session' }).click();
    const dialog = page.locator('[data-slot="dialog-content"]');
    await dialog.waitFor({ timeout: 10_000 });
    // The playlists query fills the select after the dialog opens.
    await page.waitForFunction(() => document.querySelectorAll('[data-slot="dialog-content"] select option').length > 1, null, { timeout: 10_000 });
    await page.waitForTimeout(400);

    const m = await page.evaluate(() => {
      const d = document.querySelector('[data-slot="dialog-content"]');
      const dr = d.getBoundingClientRect();
      const inside = (el) => {
        const r = el.getBoundingClientRect();
        return r.left >= dr.left - 0.5 && r.right <= dr.right + 0.5;
      };
      const input = d.querySelector('input');
      const select = d.querySelector('select');
      const go = [...d.querySelectorAll('button')].find((b) => /Go live/.test(b.textContent ?? ''));
      return {
        scrollWidth: d.scrollWidth,
        clientWidth: d.clientWidth,
        dialogRight: Math.round(dr.right),
        vw: document.documentElement.clientWidth,
        input: inside(input),
        select: inside(select),
        go: go ? inside(go) : false,
        selectW: Math.round(select.getBoundingClientRect().width),
      };
    });
    check(`${width}px: the dialog does not scroll sideways (scrollWidth <= clientWidth)`,
      m.scrollWidth <= m.clientWidth, `scrollWidth ${m.scrollWidth}, clientWidth ${m.clientWidth}`);
    check(`${width}px: the dialog stays on screen`, m.dialogRight <= m.vw, `right ${m.dialogRight}, window ${m.vw}`);
    check(`${width}px: name box, playlist select and Go live sit inside the dialog`,
      m.input && m.select && m.go, `input ${m.input}, select ${m.select} (${m.selectW}px), go ${m.go}`);
    check(`${width}px: no page errors`, errors.length === 0, errors.join(' | '));

    if (SHOT_DIR) {
      const r = await dialog.boundingBox();
      const x = Math.max(0, r.x - 12);
      await page.screenshot({
        path: path.join(SHOT_DIR, `${SHOT_TAG}-${width}.png`),
        clip: { x, y: Math.max(0, r.y - 12), width: Math.min(width - x, r.width + 24), height: r.height + 24 },
      });
    }
    await ctx.close();
  }
} finally {
  if (browser) await browser.close();
}

const failed = out.filter((r) => !r.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
if (failed.length) process.exit(1);
