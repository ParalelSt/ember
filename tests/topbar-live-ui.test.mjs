/** The desktop top bar candidates, live in the real app (PREVIEW ONLY,
 *  components/nav/TopBarPreviewSwitch.tsx; delete this test with it once
 *  the owner picks one).
 *
 *      APP_URL=http://127.0.0.1:3054 node tests/topbar-live-ui.test.mjs
 *
 *  `?topbar=1|2|3` puts the search bar `sticky top-0` inside
 *  `data-app-scroller` (1 floating pill, 2 frosted bar, 3 solid strip);
 *  `?topbar=4` is the layout as it is. At 1280x800 and 1920x1080, under the
 *  Midnight and Mono themes, with a song in the player bar, for each of 1
 *  to 3 on Home:
 *
 *    - the scroller's top is the content column's top (scrollbar from the
 *      very top);
 *    - pill bottom to page heading at scroll top matches mode 4 within 2px;
 *    - scrolled 300px, the 16px band under the pill shows nothing but the
 *      bar's own background (pixels for 1 and 3; for 2, the frosted bar's
 *      box covers it, translucent by design);
 *    - the search dropdown opens and its list is fully on screen, above the
 *      player bar, and nothing covers it.
 *
 *  And for every mode (1 to 4): playlist, album, artist, Settings and
 *  Appearance pages keep their heading clear of the bar at scroll top, Back
 *  to top shows and scrolls back to 0, and the lyrics panel sits right
 *  under the bar and ends at the scroller's bottom, staying there when the
 *  page scrolls.
 *
 *  The theme is switched through PATCH /api/theme for the run and put back
 *  after. SHOT_DIR=dir saves Home top and scrolled for each mode at
 *  1512x830 (Midnight). Needs the sandbox (tests/README.md) and
 *  playwright-core. */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('needs playwright-core: npm i -D playwright-core');
  process.exit(2);
}

const PB = process.env.PB_URL ?? 'http://127.0.0.1:8088';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:3054';
const EMAIL = process.env.EMBER_EMAIL ?? 'strixparalel@gmail.com';
const PASSWORD = process.env.EMBER_PASSWORD ?? 'EmberTest2026!';
const SHOTS = process.env.SHOT_DIR ?? '';
const QUERY = process.env.QUERY ?? 'radiohead';

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
    const r = (el) => (el ? el.getBoundingClientRect() : null);
    const player = document.querySelector('[data-testid="player-bar"]');
    return {
      columnTop: r(column).top,
      scrollerTop: r(scroller).top,
      scrollerBottom: r(scroller).bottom,
      scrollerLeft: r(scroller).left,
      scrollerInnerRight: r(scroller).left + scroller.clientWidth,
      scrollTop: scroller.scrollTop,
      barTop: r(bar)?.top ?? null,
      barBottom: r(bar)?.bottom ?? null,
      pillBottom: r(pill)?.bottom ?? null,
      headingTop: r(heading)?.top ?? null,
      playerTop: r(player)?.top ?? null,
      mode: bar?.getAttribute('data-topbar-mode') ?? null,
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
  const status = await page.evaluate(async (body) => {
    const res = await fetch('/api/theme', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body });
    return res.status;
  }, JSON.stringify(preset));
  return status;
}

let browser = null;
let restorePage = null;
try {
  browser = await chromium.launch({ executablePath: findChrome(), headless: true });

  const newPage = async (width, height, mode) => {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    await ctx.addCookies([{ name: 'pb_auth', value: cookieValue, url: APP }]);
    await ctx.addInitScript(({ v, m }) => {
      try {
        localStorage.setItem('ember.player.v1', v);
        localStorage.setItem('ember-topbar-preview', String(m));
      } catch {}
    }, { v: LOADED, m: mode });
    return ctx.newPage();
  };

  restorePage = await newPage(1280, 800, 4);
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
      const tag = `${theme} ${size.width}`;
      const base = {};
      for (const mode of [4, 1, 2, 3]) {
        const page = await newPage(size.width, size.height, mode);
        const label = `${tag} mode ${mode}`;

        // ---- Home, scroll top.
        await goto(page, `${APP}/?topbar=${mode}`);
        const top = await measure(page);
        check(`${label}: bar mode applied`, top.mode === String(mode), `data-topbar-mode ${top.mode}`);
        const gap = top.headingTop - top.pillBottom;
        if (mode === 4) {
          base.gap = gap;
          base.headingTop = top.headingTop;
        } else {
          check(
            `${label}: scrollbar starts at the top of the column`,
            Math.abs(top.scrollerTop - top.columnTop) <= 1,
            `scroller ${top.scrollerTop}, column ${top.columnTop}`,
          );
          check(
            `${label}: heading gap matches mode 4 within 2px`,
            Math.abs(gap - base.gap) <= 2,
            `gap ${gap.toFixed(1)}, mode 4 ${base.gap.toFixed(1)}`,
          );

          // ---- Scrolled 300: the 16px band under the pill.
          await setScroll(page, 300);
          const s = await measure(page);
          const clip = {
            x: Math.round(s.scrollerLeft) + 1,
            y: Math.round(s.pillBottom) + 1,
            width: Math.round(s.scrollerInnerRight - s.scrollerLeft) - 2,
            height: 14,
          };
          if (mode === 2) {
            check(
              `${label}: the frosted bar's box covers the 16px band`,
              s.barBottom >= s.pillBottom + 16 - 0.5,
              `bar bottom ${s.barBottom}, pill bottom ${s.pillBottom}`,
            );
          } else {
            const px = await bandPixels(page, clip);
            const [r0, g0, b0] = px;
            let off = 0;
            for (let i = 0; i < px.length; i += 4) {
              if (Math.abs(px[i] - r0) + Math.abs(px[i + 1] - g0) + Math.abs(px[i + 2] - b0) > 6) off++;
            }
            check(
              `${label}: scrolled 300px, the 16px band under the pill is only bar background`,
              off === 0,
              `${off} of ${px.length / 4} pixels differ from rgb(${r0},${g0},${b0})`,
            );
          }
          await setScroll(page, 0);

          // ---- Search dropdown.
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
        }

        // ---- Screenshots (Midnight, 1512x830) are taken in their own pass.

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
          const barEdge = mode === 4 ? m.scrollerTop : m.barBottom;
          check(
            `${label}, ${name}: heading clear of the bar at scroll top`,
            m.headingTop === null || m.headingTop >= barEdge - 0.5,
            `heading ${m.headingTop}, bar edge ${barEdge}`,
          );
          const scrollable = await page.evaluate(() => {
            const s = document.querySelector('[data-app-scroller]');
            return s.scrollHeight - s.clientHeight;
          });
          if (scrollable > 600) {
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
                const bar = document.querySelector('[data-testid="topbar-bar"]');
                const inScroller = bar && bar.closest('[data-app-scroller]');
                const want = inScroller ? bar.getBoundingClientRect().bottom : s.top;
                return { top: a.top, bottom: a.bottom, want, sBottom: s.bottom };
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
  }

  // ---- Screenshots: Home, top and scrolled, 1512x830, Midnight.
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await setTheme(restorePage, { preset: 'midnight' });
    for (const mode of [1, 2, 3, 4]) {
      const page = await newPage(1512, 830, mode);
      await goto(page, `${APP}/?topbar=${mode}`);
      // The seeded song cannot play here; its error toast is not the subject.
      await page.addStyleTag({ content: '[data-sonner-toaster]{display:none!important}' });
      await page.screenshot({ path: path.join(SHOTS, `home-mode${mode}-top.png`) });
      await setScroll(page, 300);
      await page.screenshot({ path: path.join(SHOTS, `home-mode${mode}-scrolled.png`) });
      await page.context().close();
    }
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
