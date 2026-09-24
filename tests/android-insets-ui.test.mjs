/** Android's system navigation buttons never cover Ember's controls.
 *
 *      PB_URL=http://127.0.0.1:8086 APP_URL=http://127.0.0.1:3053 \
 *        node tests/android-insets-ui.test.mjs     # or: npm run test:android-insets-ui
 *
 *  The Android app targets SDK 35, so Android 15 draws the status bar and
 *  the navigation bar (three buttons or the gesture pill) OVER the WebView,
 *  and the WebView reports 0 for them through env(safe-area-inset-*).
 *  MainActivity publishes the real window insets as --ember-inset-* on
 *  <html> (SafeAreaInsets.kt) and globals.css folds them into --safe-top /
 *  --safe-bottom. This drives a 390x844 Chromium tab with the phone's own
 *  script injected (a 48px navigation bar, the three-button size, and a
 *  24px status bar), and checks that nothing a finger needs sits in the
 *  bottom 48px or the top 24px:
 *
 *    - the bottom nav (its buttons above the strip, the nav's own
 *      background filling it), the phone player bar, and Back to top;
 *    - the playlist Copy to… bar in select mode, and its Copy to… sheet;
 *    - the hamburger drawer: header below the status bar, account row
 *      above the buttons;
 *    - the queue sheet from the full-screen player;
 *    - the inset survives a client-side navigation, and comes back when
 *      something rewrites <html>'s style attribute (the native script's
 *      watcher);
 *    - with no inset at all (a desktop browser, the web), nothing moves.
 *
 *  Creates its own member, playlist and liked songs through the app's own
 *  API and deletes the member at the end. Needs a sandbox (PocketBase at
 *  PB_URL with this tree's migrations and hooks, the app built from this
 *  tree at APP_URL), the superuser from EMBER_PB_SUPERUSER_* (the sandbox
 *  default otherwise) and playwright-core with a Chromium (CHROME_PATH, or
 *  the Playwright cache). SHOT_DIR keeps screenshots. */
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

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8086';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3053';
const SHOT_DIR = process.env.SHOT_DIR;
const PASSWORD = 'AndroidInsets2026!';
const W = 390;
const H = 844;
const BOTTOM = 48;
const TOP = 24;

// Exactly what MainActivity injects for a 48dp navigation bar
// (SafeAreaInsets.script(0, 0, 48, 0); SafeAreaInsetsTest pins this
// literal byte for byte), with the status bar's 24px put in.
const NATIVE_INSET_SCRIPT_48 =
  "(function(){var w=window;w.__emberInsets={'--ember-inset-top':'0px','--ember-inset-right':'0px','--ember-inset-bottom':'48px','--ember-inset-left':'0px'};function a(){var e=document.documentElement;if(!e)return false;var v=w.__emberInsets;for(var k in v)if(e.style.getPropertyValue(k)!==v[k])e.style.setProperty(k,v[k]);if(!w.__emberInsetsWatch&&w.MutationObserver){w.__emberInsetsWatch=new MutationObserver(a);w.__emberInsetsWatch.observe(e,{attributes:true,attributeFilter:['style']});}return true;}if(!a())document.addEventListener('readystatechange',a);})();";
const NATIVE_INSET_SCRIPT = NATIVE_INSET_SCRIPT_48.replace("'--ember-inset-top':'0px'", `'--ember-inset-top':'${TOP}px'`);

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
    const res = await fetch(`${PB_URL}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        identity: process.env.EMBER_PB_SUPERUSER_EMAIL ?? 'admin@ember.com',
        password: process.env.EMBER_PB_SUPERUSER_PASSWORD ?? 'egKa5WNMx3QpuG7',
      }),
    });
    if (res.ok) return (await res.json()).token;
  }
  throw new Error('could not authenticate as PB admin');
}

const token = await adminToken();
const email = `android-insets-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
const made = await fetch(`${PB_URL}/api/collections/users/records`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: token },
  body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name: 'Inset Tester', verified: true }),
});
if (!made.ok) throw new Error(`could not create the member: ${made.status} ${await made.text()}`);
const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identity: email, password: PASSWORD }),
}).then((r) => r.json());
const cookie = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));

async function api(method, p, body) {
  const res = await fetch(`${APP_URL}/api${p}`, {
    method,
    headers: { 'content-type': 'application/json', cookie: `pb_auth=${cookie}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const art = (hex) =>
  'data:image/svg+xml,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#${hex}"/></svg>`);
function song(i) {
  const sourceId = `ai${String(i).padStart(3, '0')}`.padEnd(11, '0');
  return {
    id: `youtube:${sourceId}`, source: 'youtube', sourceId,
    title: `Inset Song ${i}`, artist: 'Edge Case', artistId: null, album: 'Edges', albumId: null,
    durationSec: 180 + i, artworkUrl: art((0x406080 + i * 0x0a0a0a).toString(16).slice(-6)), streamUrl: '',
  };
}
// Long enough that the page scrolls past Back to top's 400px.
const SONGS = Array.from({ length: 24 }, (_, i) => song(i + 1));
const playlist = (await api('POST', '/playlists', { name: 'Edge to edge' })).playlist;
for (const t of SONGS) await api('POST', `/playlists/${playlist.id}/tracks`, { track: t });

async function cleanup() {
  const r = await fetch(`${PB_URL}/api/collections/users/records/${auth.record.id}`, { method: 'DELETE', headers: { Authorization: token } });
  console.log(r.ok ? 'cleanup: test member removed' : `cleanup: member not deleted (${r.status})`);
}

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });

async function openPage({ inset }) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await ctx.addCookies([{ name: 'pb_auth', value: cookie, url: APP_URL }]);
  // A song in the player, so the phone player bar is on screen.
  await ctx.addInitScript((t) => {
    try {
      if (!localStorage.getItem('ember.player.v1')) {
        localStorage.setItem('ember.player.v1', JSON.stringify({
          state: { queue: [t], index: 0, position: 3, volume: 0.25, context: null, loopMode: 'off', baseCount: 0, muted: false }, version: 0,
        }));
      }
    } catch {}
  }, SONGS[0]);
  // The phone's own script, as a document-start script like the shell's.
  if (inset) await ctx.addInitScript({ content: NATIVE_INSET_SCRIPT });
  const page = await ctx.newPage();
  return { ctx, page };
}

async function goto(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' });
  // Toasts (no audio in a headless tab) are not what is measured here.
  await page.addStyleTag({ content: '[data-sonner-toaster] { display: none !important; }' });
}

async function shot(page, name) {
  if (!SHOT_DIR) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, name) });
}

const box = (page, selector) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return el ? el.getBoundingClientRect().toJSON() : null;
}, selector);

/** The lowest bottom edge among the element's visible, tappable children. */
const lowestTarget = (page, selector) => page.evaluate((s) => {
  const root = document.querySelector(s);
  if (!root) return null;
  let low = -Infinity;
  for (const el of root.querySelectorAll('a, button, [role="button"], input')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) low = Math.max(low, r.bottom);
  }
  return low;
}, selector);

const safeBottom = (page) => page.evaluate(() => {
  const p = document.createElement('div');
  p.style.cssText = 'position:fixed;bottom:0;width:1px;height:var(--safe-bottom)';
  document.body.appendChild(p);
  const h = p.getBoundingClientRect().height;
  p.remove();
  return h;
});

const LIMIT = H - BOTTOM;
const r1 = (n) => Math.round(n * 10) / 10;

try {
  // ---------------- with the phone's insets ----------------
  const { ctx, page } = await openPage({ inset: true });
  await goto(page, `${APP_URL}/playlist/${playlist.id}`);
  await page.getByTestId('track-row').first().waitFor({ timeout: 20000 });
  await page.getByTestId('phone-player-bar').waitFor({ timeout: 20000 });

  check('the page reads the published inset as --safe-bottom', (await safeBottom(page)) === BOTTOM, `${await safeBottom(page)}px`);

  const nav = await box(page, '[data-testid="mobile-nav"]');
  const navPad = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="mobile-nav"]')).paddingBottom);
  check('the bottom nav reaches the screen edge, so its colour fills the strip under the buttons', r1(nav.bottom) === H, `bottom ${nav.bottom}`);
  check('the bottom nav pads itself by the inset', navPad === `${BOTTOM}px`, navPad);
  const navLow = await lowestTarget(page, '[data-testid="mobile-nav"]');
  check('every bottom nav button sits above the system buttons', navLow <= LIMIT, `lowest ${r1(navLow)} vs ${LIMIT}`);

  const bar = await box(page, '[data-testid="phone-player-bar"]');
  check('the phone player bar sits above the system buttons', bar && bar.bottom <= LIMIT, bar ? `bottom ${r1(bar.bottom)}` : 'missing');
  check('the phone player bar sits on top of the nav', bar && Math.abs(bar.bottom - nav.top) <= 1, bar ? `${r1(bar.bottom)} vs nav ${r1(nav.top)}` : '');
  await shot(page, 'insets-playlist.png');

  // Back to top: scroll the page past 400px.
  await page.evaluate(() => document.querySelector('[data-app-scroller]').scrollTo({ top: 900 }));
  await page.waitForTimeout(500);
  const back = await box(page, '[data-back-to-top]');
  check('Back to top floats above the phone player bar', back && back.bottom <= bar.top, back ? `${r1(back.bottom)} vs bar ${r1(bar.top)}` : 'missing');
  await page.evaluate(() => document.querySelector('[data-app-scroller]').scrollTo({ top: 0 }));
  await page.waitForTimeout(300);

  // Select mode: the Copy to… bar.
  await page.getByTestId('select-toggle').click();
  await page.getByTestId('track-row').filter({ hasText: 'Inset Song 2' }).first().click();
  await page.getByTestId('copy-bar').waitFor({ timeout: 5000 });
  await page.waitForTimeout(200);
  const copy = await box(page, '[data-testid="copy-bar"]');
  const copyLow = await lowestTarget(page, '[data-testid="copy-bar"]');
  check('the playlist Copy to… bar sits above the system buttons', copy.bottom <= LIMIT && copyLow <= LIMIT, `bar ${r1(copy.bottom)}, lowest button ${r1(copyLow)}`);
  check('the Copy to… bar sits above the phone player bar', copy.bottom <= bar.top + 0.5, `${r1(copy.bottom)} vs ${r1(bar.top)}`);
  await shot(page, 'insets-copy-bar.png');

  // Its Copy to… sheet (a bottom sheet on a phone).
  await page.getByTestId('copy-to').click();
  await page.getByTestId('copy-destinations').waitFor({ timeout: 5000 });
  await page.waitForTimeout(500);
  const sheet = await box(page, '[data-slot="sheet-content"][data-side="bottom"]');
  const sheetPad = await page.evaluate(() => getComputedStyle(document.querySelector('[data-slot="sheet-content"][data-side="bottom"]')).paddingBottom);
  const sheetLow = await lowestTarget(page, '[data-slot="sheet-content"][data-side="bottom"]');
  check('the Copy to… sheet reaches the screen edge and pads itself by the inset', sheet && r1(sheet.bottom) === H && sheetPad === `${BOTTOM}px`, `bottom ${sheet?.bottom}, padding ${sheetPad}`);
  check('every Copy to… destination sits above the system buttons', sheetLow <= LIMIT, `lowest ${r1(sheetLow)}`);
  await shot(page, 'insets-copy-sheet.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.getByTestId('select-toggle').click().catch(() => {});

  // The hamburger drawer.
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.locator('[data-slot="sheet-content"][data-side="left"]').waitFor({ timeout: 5000 });
  await page.waitForTimeout(500);
  const drawer = await box(page, '[data-slot="sheet-content"][data-side="left"]');
  const drawerHeader = await box(page, '[data-slot="sheet-content"][data-side="left"] [data-slot="sheet-header"]');
  const account = await box(page, '[data-slot="sheet-content"][data-side="left"] a[href="/settings/profile"]');
  const drawerClose = await box(page, '[data-slot="sheet-content"][data-side="left"] [data-slot="sheet-close"]');
  check('the drawer fills the screen height, its colour under both bars', drawer && r1(drawer.top) === 0 && r1(drawer.bottom) === H, `${drawer?.top}..${drawer?.bottom}`);
  check('the drawer header starts below the status bar', drawerHeader && drawerHeader.top >= TOP, `top ${drawerHeader?.top}`);
  check('the drawer close button sits below the status bar', drawerClose && drawerClose.top >= TOP, `top ${drawerClose?.top}`);
  check('the drawer account row sits above the system buttons', account && account.bottom <= LIMIT, `bottom ${account ? r1(account.bottom) : 'missing'}`);
  await shot(page, 'insets-drawer.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // The queue sheet, from the full-screen player.
  await page.locator('[data-testid="phone-player-bar"] [data-testid="marquee"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="now-playing"]')?.getAttribute('aria-hidden') === 'false', null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.locator('[data-testid="now-playing"]').getByRole('button', { name: 'Queue', exact: true }).click();
  await page.locator('[data-slot="sheet-content"][data-side="right"]').waitFor({ timeout: 5000 });
  await page.waitForTimeout(600);
  const queue = await box(page, '[data-slot="sheet-content"][data-side="right"]');
  const queuePad = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('[data-slot="sheet-content"][data-side="right"]'));
    return [cs.paddingTop, cs.paddingBottom];
  });
  check('the queue sheet pads itself below the status bar and above the system buttons',
    queue && r1(queue.bottom) === H && queuePad[0] === `${TOP}px` && queuePad[1] === `${BOTTOM}px`, `${queuePad.join(' / ')}`);
  await shot(page, 'insets-queue.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if (await page.locator('[data-testid="now-playing"]').getAttribute('aria-hidden') === 'false') {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }

  // A client-side navigation keeps it; so does something rewriting <html>'s style.
  await page.locator('[data-testid="mobile-nav"] a[href="/library"]').click();
  await page.waitForURL(/\/library/, { timeout: 10000 });
  await page.waitForTimeout(500);
  check('the inset survives a client-side navigation', (await safeBottom(page)) === BOTTOM, `${await safeBottom(page)}px`);
  await page.evaluate(() => document.documentElement.setAttribute('style', 'color-scheme: dark'));
  await page.waitForTimeout(100);
  check('the inset comes back when <html>\'s style attribute is rewritten', (await safeBottom(page)) === BOTTOM, `${await safeBottom(page)}px`);
  await page.evaluate(() => document.documentElement.removeAttribute('style'));
  await page.waitForTimeout(100);
  check('the inset comes back when <html>\'s style attribute is removed', (await safeBottom(page)) === BOTTOM, `${await safeBottom(page)}px`);
  await ctx.close();

  // ---------------- no inset at all (the web, desktop, iOS with none) ----------------
  const plain = await openPage({ inset: false });
  await goto(plain.page, `${APP_URL}/playlist/${playlist.id}`);
  await plain.page.getByTestId('phone-player-bar').waitFor({ timeout: 20000 });
  check('with no inset --safe-bottom is 0', (await safeBottom(plain.page)) === 0);
  const plainNavPad = await plain.page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="mobile-nav"]')).paddingBottom);
  check('with no inset the nav carries no padding', plainNavPad === '0px', plainNavPad);
  await plain.page.getByRole('button', { name: 'Open menu' }).click();
  await plain.page.locator('[data-slot="sheet-content"][data-side="left"]').waitFor({ timeout: 5000 });
  await plain.page.waitForTimeout(500);
  const plainPad = await plain.page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('[data-slot="sheet-content"][data-side="left"]'));
    return [cs.paddingTop, cs.paddingBottom];
  });
  check('with no inset the drawer carries no padding', plainPad[0] === '0px' && plainPad[1] === '0px', plainPad.join(' / '));
  await plain.ctx.close();
} catch (e) {
  check('the run finished', false, e.message.split('\n')[0]);
} finally {
  await browser.close();
  await cleanup();
}

const failed = checks.filter(([, pass]) => !pass).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
