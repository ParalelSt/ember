/** Bughunt V1: the desktop player bar loses the song title from 768 to
 *  about 1279 wide.
 *
 *      APP_URL=http://127.0.0.1:3052 PB_URL=http://127.0.0.1:8087 \
 *      ADMIN_USER_EMAIL=strixparalel@gmail.com ADMIN_USER_PASSWORD='EmberTest2026!' \
 *        node tests/layout-v1-player-bar.test.mjs
 *
 *  components/player/PlayerBar.tsx split the bar 1fr / 2fr / 1fr with like,
 *  add and share always beside the title, so on a narrow desktop window the
 *  title column had no room left: 0px wide at 1024, the buttons running
 *  over the artwork and the loop button at 768, "Let Do..." at 1280.
 *
 *  Seeds a playing track through the player's own saved state (no audio
 *  needed: the bar renders for the current track), then at 768, 1024, 1280
 *  and 1920 checks the title's width, that no two controls in the bar
 *  overlap, that nothing leaves the window, that share (and below lg lyrics
 *  and tabs) is still reachable from the "More" menu, and that 1920 keeps
 *  today's columns. SHOT_DIR + SHOT_TAG save a cropped bar per width.
 *
 *  Needs playwright-core and a Chromium (CHROME_PATH, or the Playwright
 *  cache), and the seed user signed up on PB_URL. */
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
const SHOT_TAG = process.env.SHOT_TAG ?? 'V1';

// Title box width each window must at least give the song name.
const MIN_TITLE = { 768: 60, 1024: 120, 1280: 120, 1920: 200 };
// The 1920 bar's three columns before the fix (left, right edges): the wide
// layout must not move.
const COLS_1920 = [[256, 660], [676, 1484], [1500, 1904]];

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
const cookieValue = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));

const ART =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#6b8fa3"/><circle cx="32" cy="32" r="18" fill="#d9a066"/></svg>',
  );
const TRACK = {
  id: 'v1-seed-track', source: 'youtube', sourceId: 'vid00000000', title: 'Let Down', artist: 'Radiohead',
  artistId: 'UCv1artist', album: 'OK Computer', albumId: null, durationSec: 299, artworkUrl: ART, streamUrl: '',
};

let browser = null;
try {
  browser = await chromium.launch({ executablePath: findChrome(), headless: true });

  for (const width of [768, 1024, 1280, 1920]) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 1 });
    await ctx.addCookies([{ name: 'pb_auth', value: cookieValue, url: APP }]);
    await ctx.addInitScript((t) => {
      localStorage.setItem('ember.player.v1', JSON.stringify({
        state: { queue: [t], index: 0, position: 3, volume: 0.25, context: null, loopMode: 'off', baseCount: 0, muted: false },
        version: 0,
      }));
    }, TRACK);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${APP}/library`, { waitUntil: 'networkidle' });
    const footer = page.locator('footer[data-testid="player-bar"]');
    await footer.waitFor({ timeout: 30_000 });
    // The seeded song has no audio, so a "Couldn't load" toast pops up over
    // the bar; hide it so the screenshots show the bar itself.
    await page.addStyleTag({ content: '[data-sonner-toaster] { display: none !important; }' });
    await page.waitForTimeout(600);
    if (SHOT_DIR) {
      const r = await footer.boundingBox();
      await page.screenshot({
        path: path.join(SHOT_DIR, `${SHOT_TAG}-${width}.png`),
        clip: { x: 0, y: Math.max(0, r.y - 8), width, height: r.height + 8 },
      });
    }

    const m = await page.evaluate((title) => {
      const f = document.querySelector('footer[data-testid="player-bar"]');
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width };
      };
      const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const titleEl = f.querySelector(`[title="${title}"]`);
      const parts = [];
      const img = f.querySelector('img');
      if (img && shown(img)) parts.push({ name: 'artwork', ...box(img) });
      if (titleEl) parts.push({ name: 'title', ...box(titleEl) });
      for (const b of f.querySelectorAll('button')) {
        if (shown(b)) parts.push({ name: b.getAttribute('aria-label') ?? b.textContent?.trim() ?? '?', ...box(b) });
      }
      const grid = f.firstElementChild;
      return {
        vw: document.documentElement.clientWidth,
        titleW: titleEl ? titleEl.getBoundingClientRect().width : 0,
        parts,
        cols: [...grid.children].map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }),
        labels: parts.map((p) => p.name),
      };
    }, TRACK.title);

    check(`${width}px: the title gets at least ${MIN_TITLE[width]}px`, m.titleW >= MIN_TITLE[width], `title ${Math.round(m.titleW)}px`);

    const overlaps = [];
    for (let i = 0; i < m.parts.length; i++) {
      for (let j = i + 1; j < m.parts.length; j++) {
        const a = m.parts[i], b = m.parts[j];
        const x = Math.min(a.r, b.r) - Math.max(a.l, b.l);
        const y = Math.min(a.b, b.b) - Math.max(a.t, b.t);
        if (x > 0.5 && y > 0.5) overlaps.push(`${a.name} x ${b.name} (${Math.round(x)}px)`);
      }
    }
    check(`${width}px: no two things in the bar overlap`, overlaps.length === 0, overlaps.slice(0, 4).join(' | '));
    const outside = m.parts.filter((p) => p.r > m.vw + 0.5 || p.l < -0.5).map((p) => p.name);
    check(`${width}px: nothing in the bar leaves the window`, outside.length === 0, outside.join(', '));

    if (width >= 1280) {
      const want = ['Like', 'Add to playlist', `Share ${TRACK.title}`];
      // The heart reads "Unlike" when the seed user already likes a song with
      // the same title and artist (the variant rule), as on a shared sandbox.
      const labels = m.labels.map((n) => (n === 'Unlike' ? 'Like' : n));
      const missing = want.filter((n) => !labels.includes(n));
      check(`${width}px: like, add and share still sit beside the title`, missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : '');
    } else {
      // Share (and, below lg, lyrics and tabs) moved into the "More" menu.
      const more = page.locator('footer[data-testid="player-bar"] button[aria-label="More"]');
      const hasMore = (await more.count()) > 0 && (await more.first().isVisible());
      let items = [];
      if (hasMore) {
        await more.first().click();
        await page.waitForTimeout(300);
        items = await page.locator('[role="menuitem"]').allInnerTexts();
        if (SHOT_DIR && width === 768) {
          await page.screenshot({ path: path.join(SHOT_DIR, `${SHOT_TAG}-menu-${width}.png`), clip: { x: 240, y: 360, width: 528, height: 440 } });
        }
        await page.keyboard.press('Escape');
      }
      const want = ['Share', 'New playlist', ...(width < 1024 ? ['Lyrics', 'Guitar tabs'] : [])];
      const missing = want.filter((w) => !items.some((t) => t.trim() === w));
      check(`${width}px: the More menu holds ${want.join(', ')}`, hasMore && missing.length === 0,
        hasMore ? (missing.length ? `missing ${missing.join(', ')}; saw ${items.join(' / ')}` : '') : 'no More button in the bar');
    }

    if (width === 1920) {
      const same = JSON.stringify(m.cols) === JSON.stringify(COLS_1920);
      check('1920px: the three columns are where they were before the fix', same, JSON.stringify(m.cols));
    }
    check(`${width}px: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
} finally {
  if (browser) await browser.close();
}

const failed = out.filter((r) => !r.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
if (failed.length) process.exit(1);
