/** The desktop top bar, the "floating pill" (0.7.1, components/nav/
 *  DesktopTopBar.tsx): the search bar is `sticky top-0` INSIDE the page
 *  scroller, so the scrollbar runs the whole content column and the page
 *  slides away under the pill.
 *
 *      PB_URL=http://127.0.0.1:8084 APP_URL=http://127.0.0.1:3055 \
 *        node tests/topbar-ui.test.mjs          # or: npm run test:topbar-ui
 *
 *  At 1280x800 and 1920x1080, under the Midnight and Mono themes, with a
 *  song in the player bar:
 *
 *    - Home at scroll top: the scroller's top is the content column's top
 *      (scrollbar from the very top), the pill's bottom is 80px down and
 *      the page heading 112px down, exactly where they were with the bar
 *      above the scroller (measured on 0.7.0: PILL_BOTTOM, HEADING_TOP);
 *    - scrolled 300px (on the first of Home, a playlist or Liked songs
 *      that scrolls that far): the 16px band under the pill shows nothing
 *      but the bar's background (pixels), and a fade follows it;
 *    - the search dropdown opens with its list fully on screen, above the
 *      player bar, and nothing covers it;
 *    - playlist, album, artist, Settings and Appearance keep their heading
 *      clear of the bar at scroll top, and Back to top scrolls back to 0;
 *    - the lyrics panel sits right under the bar and ends at the
 *      scroller's bottom, and stays there when the page scrolls.
 *
 *  And at 390x844 (a phone): no desktop bar, the scroller starts under the
 *  phone top bar and the heading sits where it did (PHONE_HEADING_GAP).
 *
 *  Signs in the seed user (EMBER_EMAIL / EMBER_PASSWORD) and switches its
 *  theme through PATCH /api/theme for the run, putting it back after, so
 *  point it at a throwaway copy of the sandbox database (tests/README.md),
 *  never a shared one. SHOT_DIR=dir saves Home top and scrolled at
 *  1512x830. Needs playwright-core with a Chromium (CHROME_PATH, or the
 *  Playwright cache). */
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

const PB = process.env.PB_URL ?? 'http://127.0.0.1:8084';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:3055';
const EMAIL = process.env.EMBER_EMAIL ?? 'strixparalel@gmail.com';
const PASSWORD = process.env.EMBER_PASSWORD ?? 'EmberTest2026!';
const SHOTS = process.env.SHOT_DIR ?? '';
const QUERY = process.env.QUERY ?? 'radiohead';

/** Where the pill and the Home heading sat on 0.7.0 (the bar above the
 *  scroller), px from the top of the content column, at every desktop
 *  width: pt-page-lg (32) + the h-12 pill (48), then main's own
 *  md:p-page-lg (32). And on a phone, the heading's distance under the
 *  scroller's top (p-page, 24). */
const PILL_BOTTOM = 80;
const HEADING_TOP = 112;
const PHONE_HEADING_GAP = 24;
/** The covered band under the pill, then the fade (h-block, h-stack). */
const BAND = 16;
const FADE = 24;

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail && !pass ? `: ${detail}` : ''}`);
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
  console.error('could not sign in the seed user:', auth);
  process.exit(2);
}
const cookieValue = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));
const originalTheme = auth.record.theme ?? { v: 1, preset: 'ember' };

/** A song already in the player, so the player bar shows. */
const LOADED = JSON.stringify({
  state: {
    queue: [{ id: 'youtube:tbseed', source: 'youtube', sourceId: 'tbseed', title: 'Let Down', artist: 'Radiohead',
      artistId: null, album: null, albumId: null, durationSec: 200, artworkUrl: null, streamUrl: '' }],
    index: 0, position: 0, volume: 1, context: null, loopMode: 'off', baseCount: 1, muted: false,
  },
  version: 0,
});

/** Geometry of the shell at the current scroll position. */
const measure = (page) =>
  page.evaluate(() => {
    const scroller = document.querySelector('[data-app-scroller]');
    const column = scroller.parentElement;
    const bar = document.querySelector('[data-testid="topbar-bar"]');
    const pill = document.querySelector('[role="search"]');
    const main = scroller.querySelector('main');
    const heading = main.querySelector('h1, h2, [data-slot="page-title"]');
    const band = document.querySelector('[data-testid="topbar-band"]');
    const r = (el) => (el ? el.getBoundingClientRect() : null);
    const player = document.querySelector('[data-testid="player-bar"]');
    return {
      columnTop: r(column).top,
      scrollerTop: r(scroller).top,
      scrollerBottom: r(scroller).bottom,
      scrollerLeft: r(scroller).left,
      scrollerInnerRight: r(scroller).left + scroller.clientWidth,
      scrollTop: scroller.scrollTop,
      scrollable: scroller.scrollHeight - scroller.clientHeight,
      barInScroller: !!(bar && scroller.contains(bar)),
      barBottom: r(bar)?.bottom ?? null,
      pillBottom: r(pill)?.bottom ?? null,
      headingTop: r(heading)?.top ?? null,
      bandTop: r(band)?.top ?? null,
      bandHeight: r(band)?.height ?? null,
      // The fade is the band's next sibling in the bar's cover.
      fadeBottom: r(band?.nextElementSibling)?.bottom ?? null,
      playerTop: r(player)?.top ?? null,
    };
  });

const setScroll = async (page, y) => {
  await page.evaluate((top) => {
    document.querySelector('[data-app-scroller]').scrollTop = top;
  }, y);
  await page.waitForTimeout(250);
};

/** Pixels of a screenshot, read back through a canvas in the page. */
async function bandPixels(page, clip) {
  const png = await page.screenshot({ clip });
  return page.evaluate(async ({ b64, w, h }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return Array.from(ctx.getImageData(0, 0, w, h).data);
  }, { b64: png.toString('base64'), w: Math.round(clip.width), h: Math.round(clip.height) });
}

async function goto(page, url) {
  await page.goto(url);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.locator('[data-app-scroller] main').first().waitFor({ timeout: 15000 });
  // The seeded song cannot play here; its error toast is not the subject.
  await page.addStyleTag({ content: '[data-sonner-toaster]{display:none!important}' });
  await page.waitForTimeout(900);
}

/** A real playlist, album and artist: the user's first playlist (else Liked
 *  songs, the same track-list page), and the album and artist of a saved
 *  track. PLAYLIST_PATH / ALBUM_PATH / ARTIST_PATH override. */
async function discover() {
  const pbGet = (q) => fetch(`${PB}/api/collections/${q}`, { headers: { Authorization: auth.token } }).then((r) => r.json());
  const lists = await pbGet('playlists/records?perPage=1');
  const tracks = await pbGet(`tracks/records?perPage=1&filter=${encodeURIComponent("album_id!='' && artist_id!=''")}`);
  const t = tracks.items?.[0];
  return {
    playlist: process.env.PLAYLIST_PATH ?? (lists.items?.[0] ? `/playlist/${lists.items[0].id}` : '/library/liked'),
    album: process.env.ALBUM_PATH ?? (t ? `/album/${t.album_id}` : undefined),
    artist: process.env.ARTIST_PATH ?? (t ? `/artist/${t.artist_id}` : undefined),
  };
}

async function setTheme(page, preset) {
  return page.evaluate(async (body) => {
    const res = await fetch('/api/theme', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body });
    return res.status;
  }, JSON.stringify(preset));
}

let browser = null;
let restorePage = null;
try {
  browser = await chromium.launch({ executablePath: findChrome(), headless: true });

  const newPage = async (width, height) => {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    await ctx.addCookies([{ name: 'pb_auth', value: cookieValue, url: APP }]);
    await ctx.addInitScript((v) => {
      try {
        localStorage.setItem('ember.player.v1', v);
      } catch {}
    }, LOADED);
    return ctx.newPage();
  };

  restorePage = await newPage(1280, 800);
  await goto(restorePage, `${APP}/`);
  const links = await discover();
  console.log('pages:', JSON.stringify(links));

  const THEMES = ['midnight', 'mono'];
  const SIZES = [
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
  ];

  for (const theme of THEMES) {
    const status = await setTheme(restorePage, { preset: theme });
    check(`theme ${theme} applied for the run`, status >= 200 && status < 300, `PATCH /api/theme ${status}`);

    for (const size of SIZES) {
      const label = `${theme} ${size.width}`;
      const page = await newPage(size.width, size.height);

      // ---- Home, scroll top.
      await goto(page, `${APP}/`);
      const top = await measure(page);
      check(`${label}: the bar is inside the scroller`, top.barInScroller);
      check(
        `${label}: the scrollbar starts at the top of the column`,
        Math.abs(top.scrollerTop - top.columnTop) <= 1,
        `scroller ${top.scrollerTop}, column ${top.columnTop}`,
      );
      check(
        `${label}: the pill sits where it did (${PILL_BOTTOM}px down)`,
        Math.abs(top.pillBottom - top.columnTop - PILL_BOTTOM) <= 1,
        `pill bottom ${top.pillBottom - top.columnTop}`,
      );
      check(
        `${label}: at scroll top the heading sits where it did (${HEADING_TOP}px down)`,
        Math.abs(top.headingTop - top.columnTop - HEADING_TOP) <= 1,
        `heading ${top.headingTop - top.columnTop}`,
      );
      check(`${label}: at scroll top nothing is drawn under the pill`, top.bandTop === null, `band at ${top.bandTop}`);

      // ---- Scrolled 300: the 16px band under the pill, then the fade.
      let scrolledOn = null;
      for (const p of ['/', links.playlist, '/library/liked']) {
        if (!p) continue;
        if (p !== '/') await goto(page, `${APP}${p}`);
        const m = await measure(page);
        if (m.scrollable >= 300) {
          scrolledOn = p;
          break;
        }
      }
      if (!scrolledOn) {
        check(`${label}: a page that scrolls 300px to check the band on`, false, 'Home, the playlist and Liked songs are all short');
      } else {
        // The page's own background: main's top padding, just under the
        // pill, with nothing scrolled under it yet.
        const bgClip = { x: Math.round(top.scrollerLeft) + 4, y: Math.round(top.pillBottom) + 8, width: 4, height: 4 };
        const [br, bgG, bb] = await bandPixels(page, bgClip);
        await setScroll(page, 300);
        const s = await measure(page);
        check(
          `${label} (${scrolledOn}): scrolled, the cover's band is ${BAND}px right under the pill, then a ${FADE}px fade`,
          s.bandTop !== null &&
            Math.abs(s.bandTop - s.pillBottom) <= 0.5 &&
            Math.abs(s.bandHeight - BAND) <= 0.5 &&
            Math.abs(s.fadeBottom - (s.pillBottom + BAND + FADE)) <= 0.5,
          JSON.stringify({ band: s.bandTop, h: s.bandHeight, pill: s.pillBottom, fade: s.fadeBottom }),
        );
        const clip = {
          x: Math.round(s.scrollerLeft) + 1,
          y: Math.round(s.pillBottom) + 1,
          width: Math.round(s.scrollerInnerRight - s.scrollerLeft) - 2,
          height: BAND - 2,
        };
        const px = await bandPixels(page, clip);
        const [r0, g0, b0] = px;
        let off = 0;
        for (let i = 0; i < px.length; i += 4) {
          if (Math.abs(px[i] - r0) + Math.abs(px[i + 1] - g0) + Math.abs(px[i + 2] - b0) > 6) off++;
        }
        check(
          `${label} (${scrolledOn}): scrolled 300px, the band under the pill is only bar background`,
          off === 0,
          `${off} of ${px.length / 4} pixels differ from rgb(${r0},${g0},${b0})`,
        );
        check(
          `${label} (${scrolledOn}): the band is the page's own background`,
          Math.abs(r0 - br) + Math.abs(g0 - bgG) + Math.abs(b0 - bb) <= 6,
          `band rgb(${r0},${g0},${b0}), page rgb(${br},${bgG},${bb})`,
        );
        await setScroll(page, 0);
      }

      // ---- Search dropdown, on Home.
      await goto(page, `${APP}/`);
      const input = page.locator('[role="search"] input').first();
      await input.click();
      await input.fill(QUERY);
      const panel = page.locator('[data-testid="search-dropdown"]');
      await panel.waitFor({ state: 'visible', timeout: 5000 });
      const gotRows = await page
        .locator('[data-testid="search-dropdown"] [data-testid="track-row"]')
        .first()
        .waitFor({ timeout: 20000 })
        .then(() => true)
        .catch(() => false);
      const d = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="search-dropdown"]');
        const r = el.getBoundingClientRect();
        const player = document.querySelector('[data-testid="player-bar"]');
        const floor = player ? player.getBoundingClientRect().top : window.innerHeight;
        // Nothing drawn over the panel: probe its corners and middle.
        const pts = [
          [r.left + 12, r.top + 12], [r.right - 12, r.top + 12],
          [r.left + 12, r.bottom - 12], [r.right - 12, r.bottom - 12],
          [(r.left + r.right) / 2, (r.top + r.bottom) / 2],
        ];
        const covered = pts.filter(([x, y]) => !el.contains(document.elementFromPoint(x, y))).length;
        return { top: r.top, bottom: r.bottom, h: r.height, floor, covered };
      });
      check(
        `${label}: search dropdown fully on screen, above the player bar, uncovered${gotRows ? '' : ' (no result rows came back, geometry only)'}`,
        d.top >= 0 && d.bottom <= d.floor && d.h > 150 && d.covered === 0,
        JSON.stringify(d),
      );
      await page.keyboard.press('Escape');

      // ---- Other pages: heading clear of the bar, Back to top.
      const pages = [
        ['playlist', links.playlist],
        ['album', links.album],
        ['artist', links.artist],
        ['settings', '/settings'],
        ['appearance', '/settings/appearance'],
      ].filter(([, p]) => p);
      for (const [name, p] of pages) {
        await goto(page, `${APP}${p}`);
        const m = await measure(page);
        check(
          `${label}, ${name}: heading clear of the bar at scroll top`,
          m.headingTop === null || m.headingTop >= m.barBottom - 0.5,
          `heading ${m.headingTop}, bar bottom ${m.barBottom}`,
        );
        if (m.scrollable > 600) {
          await setScroll(page, 900);
          const btn = page.locator('button[aria-label="Back to top"]');
          await page.waitForTimeout(400);
          await btn.click();
          await page.waitForTimeout(1200);
          const after = await page.evaluate(() => document.querySelector('[data-app-scroller]').scrollTop);
          check(`${label}, ${name}: Back to top scrolls back to 0`, after === 0, `scrollTop ${after}`);
        }
      }

      // ---- Lyrics panel (the player bar's Lyrics button), on a playlist.
      if (links.playlist) {
        await goto(page, `${APP}${links.playlist}`);
        const lyricsBtn = page.locator('[data-testid="player-bar"] button[aria-label="Lyrics"]').first();
        if (await lyricsBtn.isVisible().catch(() => false)) {
          await lyricsBtn.click();
          const aside = page.locator('aside[aria-label="Lyrics"]');
          await aside.waitFor({ timeout: 5000 });
          await page.waitForTimeout(300);
          const readLyrics = () =>
            page.evaluate(() => {
              const s = document.querySelector('[data-app-scroller]').getBoundingClientRect();
              const a = document.querySelector('aside[aria-label="Lyrics"]').getBoundingClientRect();
              const bar = document.querySelector('[data-testid="topbar-bar"]').getBoundingClientRect();
              return { top: a.top, bottom: a.bottom, want: bar.bottom, sBottom: s.bottom };
            });
          const l0 = await readLyrics();
          await setScroll(page, 400);
          const l1 = await readLyrics();
          const ok = (l) => Math.abs(l.top - l.want) <= 1 && Math.abs(l.bottom - l.sBottom) <= 1;
          check(`${label}: lyrics panel under the bar, to the scroller's bottom`, ok(l0), JSON.stringify(l0));
          check(`${label}: lyrics panel stays put when the page scrolls`, ok(l1), JSON.stringify(l1));
        } else {
          console.log(`SKIP  ${label}: no Lyrics button in the player bar at this width`);
        }
      }
      await page.context().close();
    }
  }

  // ---- Phone: unchanged.
  {
    const page = await newPage(390, 844);
    await goto(page, `${APP}/`);
    const m = await measure(page);
    check('390: no desktop bar', m.barInScroller === false && m.pillBottom === null, JSON.stringify(m));
    check(
      '390: the heading sits where it did under the phone top bar',
      Math.abs(m.headingTop - m.scrollerTop - PHONE_HEADING_GAP) <= 1,
      `gap ${m.headingTop - m.scrollerTop}`,
    );
    await page.context().close();
  }

  // ---- Screenshots: Home, top and scrolled, 1512x830.
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    const page = await newPage(1512, 830);
    await goto(page, `${APP}/`);
    await page.screenshot({ path: path.join(SHOTS, 'home-top.png') });
    await setScroll(page, 300);
    await page.screenshot({ path: path.join(SHOTS, 'home-scrolled.png') });
    await page.context().close();
  }
} catch (e) {
  console.error(e);
  results.push({ name: 'run', pass: false });
} finally {
  if (restorePage) {
    const preset = originalTheme.themeId ? { themeId: originalTheme.themeId } : { preset: originalTheme.preset ?? 'ember' };
    await setTheme(restorePage, preset).catch(() => {});
  }
  await browser?.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
