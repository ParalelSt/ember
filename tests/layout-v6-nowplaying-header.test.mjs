/** Bughunt V6: in the phone's Now Playing sheet, the top buttons float over
 *  the content once it is scrolled.
 *
 *      APP_URL=http://127.0.0.1:3052 PB_URL=http://127.0.0.1:8087 \
 *      ADMIN_USER_EMAIL=strixparalel@gmail.com ADMIN_USER_PASSWORD='EmberTest2026!' \
 *        node tests/layout-v6-nowplaying-header.test.mjs
 *
 *  components/player/NowPlaying.tsx pinned Close, Guitar tabs and Queue
 *  with `absolute` over a scroller that filled the whole sheet, with no
 *  background of their own, so scrolling slid the title, the like/add/share
 *  buttons, the seek bar and the lyrics card underneath them. Check at
 *  390x844, scrolled 0, 150, 300 and 600px: no visible content of the
 *  scroller (a button, image, slider, text, or anything with a background),
 *  clipped to what the scroller shows, sits under a top button.
 *
 *  Seeds a track through the player's own saved state (no audio needed).
 *  Needs playwright-core and a Chromium (CHROME_PATH, or the Playwright
 *  cache). SHOT_DIR + SHOT_TAG save the top of the sheet scrolled 600px. */
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
const SHOT_TAG = process.env.SHOT_TAG ?? 'V6';
const HEADER = ['Close', 'Guitar tabs', 'Queue'];

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
  id: 'v6-seed-track', source: 'youtube', sourceId: 'vid00000000', title: 'Let Down', artist: 'Radiohead',
  artistId: 'UCv6artist', album: 'OK Computer', albumId: null, durationSec: 299, artworkUrl: ART, streamUrl: '',
};

let browser = null;
try {
  browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: 'pb_auth', value: cookieValue, url: APP }]);
  await ctx.addInitScript((t) => {
    localStorage.setItem('ember.player.v1', JSON.stringify({
      state: { queue: [t], index: 0, position: 9, volume: 0.25, context: null, loopMode: 'off', baseCount: 0, muted: false },
      version: 0,
    }));
  }, TRACK);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // Keep a lyrics miss from filing a report against the sandbox.
  await page.route('**/api/lyrics-report**', (r) => r.abort());
  await page.goto(`${APP}/library`, { waitUntil: 'networkidle' });
  await page.locator('[data-testid="phone-player-row"]').click({ position: { x: 150, y: 30 } });
  const sheet = page.locator('[data-testid="now-playing"]');
  await page.waitForFunction(() => {
    const s = document.querySelector('[data-testid="now-playing"]');
    return s && s.getAttribute('aria-hidden') === 'false' && getComputedStyle(s).opacity === '1';
  }, null, { timeout: 10_000 });
  await page.waitForTimeout(500);

  for (const y of [0, 150, 300, 600]) {
    const m = await page.evaluate(({ y, header }) => {
      const s = document.querySelector('[data-testid="now-playing"]');
      const scroller = [...s.querySelectorAll('div')].find((d) => getComputedStyle(d).overflowY === 'auto');
      scroller.scrollTop = y;
      const clip = scroller.getBoundingClientRect();
      const buttons = [...s.querySelectorAll('button')].filter(
        (b) => header.includes(b.getAttribute('aria-label') ?? '') && !scroller.contains(b),
      );
      const visible = (el) => {
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
        if (/^(BUTTON|IMG|SVG|INPUT)$/i.test(el.tagName) || el.getAttribute('role') === 'slider') return true;
        if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return true;
        const bg = cs.backgroundColor;
        return !!bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg);
      };
      const hits = [];
      for (const el of scroller.querySelectorAll('*')) {
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        // What the scroller actually shows of it.
        const t = Math.max(r.top, clip.top), b = Math.min(r.bottom, clip.bottom);
        const l = Math.max(r.left, clip.left), rr = Math.min(r.right, clip.right);
        if (b - t <= 0.5 || rr - l <= 0.5) continue;
        for (const btn of buttons) {
          const q = btn.getBoundingClientRect();
          const x = Math.min(rr, q.right) - Math.max(l, q.left);
          const h = Math.min(b, q.bottom) - Math.max(t, q.top);
          if (x > 0.5 && h > 0.5) {
            const label = el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 20) || el.tagName;
            hits.push(`${btn.getAttribute('aria-label')} over ${el.tagName.toLowerCase()} "${label}"`);
          }
        }
      }
      return { scrollTop: scroller.scrollTop, buttons: buttons.length, hits: [...new Set(hits)] };
    }, { y, header: HEADER });
    await page.waitForTimeout(150);
    check(`scrolled ${y}px (actual ${Math.round(m.scrollTop)}): no content under Close / Guitar tabs / Queue`,
      m.buttons >= 2 && m.hits.length === 0, m.buttons < 2 ? `found ${m.buttons} top buttons` : m.hits.slice(0, 4).join(' | '));
    if (y === 600 && SHOT_DIR) {
      await page.screenshot({ path: path.join(SHOT_DIR, `${SHOT_TAG}.png`), clip: { x: 0, y: 0, width: 390, height: 260 } });
    }
  }
  check('no page errors', errors.length === 0, errors.join(' | '));
  await sheet.count();
  await ctx.close();
} finally {
  if (browser) await browser.close();
}

const failed = out.filter((r) => !r.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
if (failed.length) process.exit(1);
