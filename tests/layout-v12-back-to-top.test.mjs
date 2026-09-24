/** Bughunt V12: the Back to top button covers controls on the right edge.
 *
 *      APP_URL=http://127.0.0.1:3053 PB_URL=http://127.0.0.1:8086 \
 *      ADMIN_USER_EMAIL=strixparalel@gmail.com ADMIN_USER_PASSWORD='EmberTest2026!' \
 *        node tests/layout-v12-back-to-top.test.mjs
 *
 *  components/nav/BackToTop.tsx floated at a fixed distance from the
 *  window's bottom edge, over the page, and the page had no room under
 *  its last row. Scrolled to the end, a right-hand control (a row's delete
 *  button, the recommendations refresh button, a form's Upload button)
 *  stayed stuck under it with no way to scroll it clear. Check: scrolled to
 *  the bottom of a long playlist, Liked songs and Settings > Appearance, at
 *  390 (with and without a song in the player bar) and 1280, the button is
 *  showing and no button, link or field on the page is under it, and it
 *  sits inside the scrolling area (never over the player bar).
 *
 *  PLAYLIST_ID picks the playlist (default: the user's first playlist with
 *  20 or more songs). SHOT_DIR=dir saves the 390px playlist corner.
 *
 *  Needs playwright-core and a Chromium (CHROME_PATH, or the Playwright
 *  cache), and a seeded, logged-in user with a long playlist and 15 or
 *  more liked songs. */
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


let playlistId = process.env.PLAYLIST_ID;
if (!playlistId) {
  const lists = await fetch(`${PB}/api/collections/playlists/records?perPage=50`, {
    headers: { Authorization: auth.token },
  }).then((r) => r.json());
  for (const p of lists.items ?? []) {
    const n = await fetch(
      `${PB}/api/collections/playlist_tracks/records?perPage=1&filter=${encodeURIComponent(`playlist="${p.id}"`)}`,
      { headers: { Authorization: auth.token } },
    ).then((r) => r.json());
    if ((n.totalItems ?? 0) >= 20) {
      playlistId = p.id;
      break;
    }
  }
}
if (!playlistId) {
  console.error('No playlist with 20+ songs for this user: seed one or set PLAYLIST_ID');
  process.exit(2);
}

/** A song already in the player (the persisted store), so the player bar
 *  shows and the scrolling area ends above it. */
const LOADED = JSON.stringify({
  state: {
    queue: [{ id: 'youtube:v12seed', source: 'youtube', sourceId: 'v12seed', title: 'Let Down', artist: 'Radiohead',
      artistId: null, album: null, albumId: null, durationSec: 200, artworkUrl: null, streamUrl: '' }],
    index: 0, position: 0, volume: 1, context: null, loopMode: 'off', baseCount: 1, muted: false,
  },
  version: 0,
});

/** Scrolls the app's scroller to the end, then lists every control whose
 *  box overlaps the Back to top button's box. */
const probe = async (page) => {
  await page.evaluate(() => {
    const s = document.querySelector('[data-app-scroller]');
    s.scrollTop = s.scrollHeight;
  });
  await page.waitForTimeout(700);
  return page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Back to top"]');
    const scroller = document.querySelector('[data-app-scroller]');
    if (!btn || !scroller) return null;
    const b = btn.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    // The part of a control a person can actually see: clipped by every
    // scrolling or overflow-hidden box it sits in (a row scrolled out of an
    // inner list, like a playlist's Recommended songs, is not under anything).
    const visibleRect = (el) => {
      const r = el.getBoundingClientRect();
      let { left, right, top, bottom } = r;
      for (let p = el.parentElement; p && p !== scroller; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const pr = p.getBoundingClientRect();
        left = Math.max(left, pr.left); right = Math.min(right, pr.right);
        top = Math.max(top, pr.top); bottom = Math.min(bottom, pr.bottom);
      }
      return { left, right, top, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
    };
    const hits = [...scroller.querySelectorAll('button, a[href], input, select, textarea, [role="button"]')]
      .filter((el) => el !== btn)
      .map((el) => ({ el, r: visibleRect(el) }))
      .filter(({ r }) => r.width > 0 && r.height > 0)
      .filter(({ r }) => r.left < b.right - 1 && r.right > b.left + 1 && r.top < b.bottom - 1 && r.bottom > b.top + 1)
      .map(({ el, r }) => `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}" @${Math.round(r.top)}`);
    return {
      visible: getComputedStyle(btn).opacity === '1',
      button: { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) },
      scrollerBottom: Math.round(s.bottom),
      hits,
    };
  });
};

let browser = null;
try {
  browser = await chromium.launch({ executablePath: findChrome(), headless: true });

  const cases = [
    { width: 390, height: 844, loaded: true },
    { width: 390, height: 844, loaded: false },
    { width: 1280, height: 800, loaded: true },
  ];
  const pages = [
    { name: 'playlist', path: `/playlist/${playlistId}` },
    { name: 'liked songs', path: '/library/liked' },
    { name: 'appearance', path: '/settings/appearance' },
  ];

  for (const c of cases) {
    const ctx = await browser.newContext({ viewport: { width: c.width, height: c.height }, deviceScaleFactor: 1 });
    await ctx.addCookies([{ name: 'pb_auth', value: cookieValue, url: APP }]);
    if (c.loaded) {
      await ctx.addInitScript((v) => {
        try {
          localStorage.setItem('ember.player.v1', v);
        } catch {}
      }, LOADED);
    }
    const page = await ctx.newPage();
    const label = `${c.width}px${c.loaded ? ', song loaded' : ', no song'}`;
    for (const p of pages) {
      await page.goto(`${APP}${p.path}`);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(1500);
      const m = await probe(page);
      if (!m) {
        check(`${label}, ${p.name}: the page has the button`, false);
        continue;
      }
      if (!m.visible) {
        // Too short to scroll 400px at this size: nothing to cover.
        console.log(`SKIP  ${label}, ${p.name}: too short for the button to show`);
        continue;
      }
      check(`${label}, ${p.name}: no control under Back to top`, m.hits.length === 0, JSON.stringify({ button: m.button, hits: m.hits }));
      check(
        `${label}, ${p.name}: the button sits inside the scrolling area`,
        m.button.bottom <= m.scrollerBottom,
        `button bottom ${m.button.bottom}, scroller bottom ${m.scrollerBottom}`,
      );
      if (SHOT_DIR && c.width === 390 && c.loaded && p.name === 'playlist') {
        await page.screenshot({ path: path.join(SHOT_DIR, 'v12-390.png'), clip: { x: 0, y: 444, width: 390, height: 400 } });
      }
      if (SHOT_DIR && c.width === 1280 && p.name === 'playlist') {
        await page.screenshot({ path: path.join(SHOT_DIR, 'v12-1280.png'), clip: { x: 640, y: 400, width: 640, height: 400 } });
      }
    }
    await ctx.close();
  }
} finally {
  if (browser) await browser.close();
}

const failed = out.filter((r) => !r.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
if (failed.length) process.exit(1);
