/** Bughunt V7: in the New playlist dialog, the recommended list spills past
 *  the footer and out of the dialog.
 *
 *      APP_URL=http://127.0.0.1:3052 PB_URL=http://127.0.0.1:8087 \
 *      ADMIN_USER_EMAIL=strixparalel@gmail.com ADMIN_USER_PASSWORD='EmberTest2026!' \
 *        node tests/layout-v7-new-playlist-dialog.test.mjs
 *
 *  components/track/menus/TrackSearchPicker.tsx capped its list at 60vh
 *  (24rem on phones) inside a wrapper that could not shrink, so in a dialog
 *  capped at 90vh the list's box ran under Cancel / Create and past the
 *  dialog's bottom edge. Check at 1280x800 and 390x844, with 20
 *  recommendations served by a stubbed /api/youtube/recommended: the list's
 *  scroll box ends above the footer, the footer stays inside the dialog,
 *  the dialog stays on screen, and the list scrolls inside itself.
 *
 *  Needs playwright-core and a Chromium (CHROME_PATH, or the Playwright
 *  cache), and a playlist of the seed user's with at least one track.
 *  SHOT_DIR + SHOT_TAG save the dialog per width. */
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
const SHOT_TAG = process.env.SHOT_TAG ?? 'V7';

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
let playlistId = null;
for (const p of lists.items ?? []) {
  const rows = await fetch(
    `${PB}/api/collections/playlist_tracks/records?perPage=1&filter=${encodeURIComponent(`playlist="${p.id}"`)}`,
    { headers: { Authorization: auth.token } },
  ).then((r) => r.json());
  if ((rows.items ?? []).length) { playlistId = p.id; break; }
}
if (!playlistId) {
  console.error('Seed a playlist with at least one track for the seed user first.');
  process.exit(2);
}
const cookieValue = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));

const RECS = Array.from({ length: 20 }, (_, i) => ({
  id: `rec-${i}`, source: 'youtube', sourceId: `rec${String(i).padStart(8, '0')}`,
  title: `Recommended song number ${i + 1}`, artist: 'Some Artist', artistId: null, album: null, albumId: null,
  durationSec: 200, artworkUrl: null, streamUrl: '',
}));

let browser = null;
try {
  browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  for (const [width, height] of [[1280, 800], [390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    await ctx.addCookies([{ name: 'pb_auth', value: cookieValue, url: APP }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route('**/api/youtube/recommended**', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tracks: RECS }) }));
    await page.goto(`${APP}/playlist/${playlistId}`, { waitUntil: 'networkidle' });
    await page.locator('main button[aria-label="Add to playlist"]').first().click();
    await page.getByRole('menuitem', { name: 'New playlist' }).click();
    const dialog = page.locator('[data-testid="create-playlist-dialog"]');
    await dialog.waitFor({ timeout: 10_000 });
    await dialog.getByText('Recommended song number 20').waitFor({ state: 'attached', timeout: 10_000 });
    await page.waitForTimeout(400);

    const m = await page.evaluate(() => {
      const d = document.querySelector('[data-testid="create-playlist-dialog"]');
      const dr = d.getBoundingClientRect();
      const footer = d.querySelector('[data-slot="dialog-footer"]').getBoundingClientRect();
      const list = [...d.querySelectorAll('div')].find(
        (el) => getComputedStyle(el).overflowY === 'auto' && el.textContent.includes('Recommended song number 1'),
      );
      const lr = list.getBoundingClientRect();
      return {
        vh: window.innerHeight,
        dialog: [Math.round(dr.top), Math.round(dr.bottom)],
        footer: [Math.round(footer.top), Math.round(footer.bottom)],
        list: [Math.round(lr.top), Math.round(lr.bottom)],
        listScrolls: list.scrollHeight > list.clientHeight,
      };
    });
    check(`${width}px: the recommended list ends above the footer`, m.list[1] <= m.footer[0],
      `list ${m.list.join('-')}, footer ${m.footer.join('-')}`);
    check(`${width}px: the footer stays inside the dialog`, m.footer[1] <= m.dialog[1],
      `footer ${m.footer.join('-')}, dialog ${m.dialog.join('-')}`);
    check(`${width}px: the dialog stays on screen`, m.dialog[0] >= 0 && m.dialog[1] <= m.vh, `dialog ${m.dialog.join('-')}, window ${m.vh}`);
    check(`${width}px: the list scrolls inside itself`, m.listScrolls);
    check(`${width}px: no page errors`, errors.length === 0, errors.join(' | '));

    if (SHOT_DIR) {
      await page.screenshot({ path: path.join(SHOT_DIR, `${SHOT_TAG}-${width}.png`) });
    }
    await ctx.close();
  }
} finally {
  if (browser) await browser.close();
}

const failed = out.filter((r) => !r.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
if (failed.length) process.exit(1);
