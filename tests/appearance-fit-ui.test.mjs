/** Bughunt F2: Settings > Appearance fits on a desktop screen.
 *
 *      EMBER_PB_SUPERUSER_EMAIL=... EMBER_PB_SUPERUSER_PASSWORD=... \
 *      PB_URL=http://127.0.0.1:8084 APP_URL=http://127.0.0.1:3055 \
 *        node tests/appearance-fit-ui.test.mjs      # or: npm run test:appearance-fit-ui
 *
 *  The owner's words: "I want this to fit on screen easily because it's
 *  kinda hard to see like this." On a 1512x830 window with the player bar
 *  showing, the preview ran past the bottom (its mini player row cut off)
 *  and so did the inspector, so the whole page had to be scrolled.
 *
 *  At 1280x720, 1440x800, 1512x830 and 1920x1000, with a song in the player
 *  bar and the page scroller at the top: the preview, its mini player row
 *  included, ends at or above the player bar and inside the scroller; the
 *  Apply bar and the Themes/Colours/Share tabs are inside the scroller; and
 *  the inspector's list (the Colours tab, the longest) scrolls inside its
 *  own panel while the page scroller stays at 0, and the next tab opens at
 *  its top. At 390 the stacked layout stays, with nothing scrolling
 *  sideways.
 *
 *  SHOT_DIR + SHOT_TAG photograph the 1512x830 window (`<tag>.png`).
 *
 *  Needs a sandbox: PocketBase (PB_URL) and the app (APP_URL) built from
 *  this tree, the superuser from EMBER_PB_SUPERUSER_* (bughunt W14), and
 *  playwright-core with a Chromium (CHROME_PATH, or the Playwright cache). */
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

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8084';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3055';
const SHOT_DIR = process.env.SHOT_DIR;
const SHOT_TAG = process.env.SHOT_TAG ?? 'F2';
const PASSWORD = 'AppearanceFit2026!';
const DESKTOP = [
  [1280, 720],
  [1440, 800],
  [1512, 830],
  [1920, 1000],
];

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = path.join(process.env.HOME ?? '', 'Library/Caches/ms-playwright');
  if (!fs.existsSync(root)) throw new Error('no Playwright browser cache, set CHROME_PATH');
  for (const d of fs.readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const found = execSync(
      `find "${path.join(root, d)}" -maxdepth 6 -type f \\( -name "Google Chrome for Testing" -o -name "Chromium" \\) 2>/dev/null | head -1`,
      { encoding: 'utf8' },
    ).trim();
    if (found) return found;
  }
  throw new Error('no Chromium binary found, set CHROME_PATH');
}

async function adminToken() {
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const res = await fetch(`${PB_URL}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        identity: process.env.EMBER_PB_SUPERUSER_EMAIL ?? 'admin@ember.com',
        password: process.env.EMBER_PB_SUPERUSER_PASSWORD ?? 'egKa5WNMx3QpuG7',
      }) });
    if (res.ok) return (await res.json()).token;
  }
  throw new Error('could not authenticate as PB admin');
}

/** A fresh member, signed in: the pb_auth cookie value. */
async function memberCookie() {
  const token = await adminToken();
  const email = `appearance-fit-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
  const made = await fetch(`${PB_URL}/api/collections/users/records`, { method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: token },
    body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name: 'Fit', verified: true }) });
  if (!made.ok) throw new Error(`could not create the member: ${made.status} ${await made.text()}`);
  const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PASSWORD }) })
    .then((r) => r.json());
  return encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));
}

const ART =
  'data:image/svg+xml,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#6b8fa3"/></svg>');
const TRACK = {
  id: 'f2-seed-track', source: 'youtube', sourceId: 'vid00000000', title: 'Let Down', artist: 'Radiohead',
  artistId: 'UCf2artist', album: 'OK Computer', albumId: null, durationSec: 299, artworkUrl: ART, streamUrl: '',
};

const cookie = await memberCookie();
const browser = await chromium.launch({ executablePath: findChrome(), headless: true });

/** Settings > Appearance at `width` x `height` with a song in the player bar. */
async function open(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: 'pb_auth', value: cookie, url: APP_URL }]);
  await ctx.addInitScript((t) => {
    localStorage.setItem('ember.player.v1', JSON.stringify({
      state: { queue: [t], index: 0, position: 3, volume: 0.25, context: null, loopMode: 'off', baseCount: 0, muted: false },
      version: 0,
    }));
  }, TRACK);
  const page = await ctx.newPage();
  await page.goto(`${APP_URL}/settings/appearance`, { waitUntil: 'networkidle' });
  await page.getByTestId('theme-count').waitFor({ timeout: 15000 });
  await page.locator('footer[data-testid="player-bar"]').waitFor({ timeout: 15000 });
  // The seeded song has no audio: hide the "Couldn't load" toast.
  await page.addStyleTag({ content: '[data-sonner-toaster] { display: none !important; }' });
  await page.waitForTimeout(500);
  return { ctx, page };
}

/** Boxes of the parts that must be in view, the scroller's visible box and
 *  its scroll position. */
const measure = (page) => page.evaluate(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
  };
  const scroller = document.querySelector('[data-app-scroller]');
  const preview = document.querySelector('[data-testid="theme-preview"]');
  return {
    scroller: box(scroller),
    scrollTop: scroller.scrollTop,
    player: box(document.querySelector('footer[data-testid="player-bar"]')),
    preview: box(preview),
    miniPlayer: box(preview?.querySelector('footer')),
    bar: box(document.querySelector('[data-testid="apply-bar"], [data-testid="in-use-bar"]')),
    tabs: box(document.querySelector('[role="tablist"][aria-label="Appearance"]')),
    list: box(document.querySelector('[data-testid="inspector-scroll"]')),
  };
});

const px = (n) => Math.round(n);
const inside = (b, s) => !!b && !!s && b.top >= s.top - 0.5 && b.bottom <= s.bottom + 0.5;

try {
  for (const [w, h] of DESKTOP) {
    const { ctx, page } = await open(w, h);
    const size = `${w}x${h}`;
    const m = await measure(page);
    check(`${size}: the page scroller is at the top`, m.scrollTop === 0, `scrollTop ${m.scrollTop}`);
    check(`${size}: the preview ends at or above the player bar`,
      !!m.preview && m.preview.bottom <= m.player.top + 0.5,
      `preview bottom ${px(m.preview?.bottom)}, player bar top ${px(m.player.top)}`);
    check(`${size}: the whole preview, its mini player row too, is inside the scroller`,
      inside(m.preview, m.scroller) && inside(m.miniPlayer, m.scroller),
      `preview ${px(m.preview?.top)}..${px(m.preview?.bottom)}, mini player bottom ${px(m.miniPlayer?.bottom)}, scroller ${px(m.scroller.top)}..${px(m.scroller.bottom)}`);
    check(`${size}: the Apply bar and the tabs are in view`,
      inside(m.bar, m.scroller) && inside(m.tabs, m.scroller),
      `bar ${px(m.bar?.top)}..${px(m.bar?.bottom)}, tabs ${px(m.tabs?.top)}..${px(m.tabs?.bottom)}`);
    check(`${size}: the inspector's panel ends inside the scroller`, inside(m.list, m.scroller),
      m.list ? `list ${px(m.list.top)}..${px(m.list.bottom)}` : 'no inspector-scroll panel');

    // Colours is the longest tab: it overflows the panel, which scrolls on
    // its own while the page stays put.
    await page.getByRole('tab', { name: 'Colours', exact: true }).click();
    await page.waitForTimeout(200);
    const s = await page.evaluate(() => {
      const list = document.querySelector('[data-testid="inspector-scroll"]');
      const scroller = document.querySelector('[data-app-scroller]');
      if (!list) return null;
      const before = { overflows: list.scrollHeight > list.clientHeight + 1, overflowY: getComputedStyle(list).overflowY };
      list.scrollTop = 10000;
      return { ...before, listTop: list.scrollTop, pageTop: scroller.scrollTop };
    });
    check(`${size}: the Colours list scrolls inside the inspector, not the page`,
      !!s && s.overflows && /auto|scroll/.test(s.overflowY) && s.listTop > 0 && s.pageTop === 0,
      s ? `overflows ${s.overflows}, overflow-y ${s.overflowY}, list scrollTop ${s.listTop}, page scrollTop ${s.pageTop}` : 'no inspector-scroll panel');
    const after = await measure(page);
    check(`${size}: on Colours, the Apply bar, tabs and preview stay in view`,
      after.scrollTop === 0 && inside(after.bar, after.scroller) && inside(after.tabs, after.scroller)
        && inside(after.preview, after.scroller),
      `page scrollTop ${after.scrollTop}`);

    await page.getByRole('tab', { name: 'Themes', exact: true }).click();
    await page.waitForTimeout(200);
    const back = await page.evaluate(() => document.querySelector('[data-testid="inspector-scroll"]')?.scrollTop);
    check(`${size}: back on Themes, the list starts at its top`, back === 0, `list scrollTop ${back}`);

    if (SHOT_DIR && w === 1512) {
      await page.getByRole('radio', { name: 'Midnight' }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOT_DIR, `${SHOT_TAG}.png`) });
    }
    await ctx.close();
  }

  // Phone: the stacked layout, nothing sideways.
  {
    const { ctx, page } = await open(390, 844);
    const o = await page.evaluate(() => {
      const scroller = document.querySelector('[data-app-scroller]');
      const preview = document.querySelector('[data-testid="theme-preview"]').getBoundingClientRect();
      const tabs = document.querySelector('[role="tablist"][aria-label="Appearance"]').getBoundingClientRect();
      return {
        doc: document.documentElement.scrollWidth,
        scroller: scroller.scrollWidth - scroller.clientWidth,
        stacked: tabs.top >= preview.bottom,
      };
    });
    check('390: nothing scrolls sideways', o.doc <= 390 && o.scroller <= 0, `document ${o.doc}, scroller extra ${o.scroller}`);
    check('390: the inspector stays under the preview', o.stacked);
    await ctx.close();
  }
} finally {
  await browser.close();
}

const failed = checks.filter(([, pass]) => !pass).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
