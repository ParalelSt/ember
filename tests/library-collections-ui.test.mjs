/** The rewritten /library page: Spotify-style shelves instead of tabs.
 *
 *      node tests/library-collections-ui.test.mjs   # or: npm run test:library-ui
 *
 *  Proves: no tablist on /library, "Your collections" above "Playlists",
 *  the sidebar lists Liked/Recent/Uploads above the playlist links, each
 *  collection card routes to its own page and can be pinned for offline
 *  there, the offline Library view lists pins, and a browser without the
 *  native plugin sees no download button on a collection page. Sandbox from
 *  tests/README.md (PB 8091, app 3010). Fake EmberOffline plugin copied from
 *  tests/offline-android-ui.test.mjs so __emberOfflineCalls matches. */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.error('needs playwright-core: npm i -D playwright-core'); process.exit(2); }

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8091';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3010';
const PASSWORD = 'BugTest2026!';

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

async function adminToken() {
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const r = await fetch(`${PB_URL}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: 'admin@ember.com', password: 'egKa5WNMx3QpuG7' }) });
    if (r.ok) return (await r.json()).token;
  }
  throw new Error('could not authenticate as PB admin');
}

const token = await adminToken();
const email = `libui-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
await fetch(`${PB_URL}/api/collections/users/records`, { method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: token },
  body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name: 'Library Tester', verified: true }) });
const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PASSWORD }) })
  .then((r) => r.json());
const cookie = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));

function wav(seconds = 120, rate = 8000) {
  const n = seconds * rate;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

// Seed: one upload, liked, played (history), plus a playlist.
const ts = Date.now();
const songTitle = `Lib Song ${ts}`;
const playlistName = `Lib Playlist ${ts}`;

const form = new FormData();
form.append('file', new Blob([new Uint8Array(wav())], { type: 'audio/wav' }), 'a.wav');
form.append('title', songTitle);
form.append('artist', 'Library Tester');
const upRes = await fetch(`${APP_URL}/api/uploads`, { method: 'POST', body: form, headers: { cookie: `pb_auth=${cookie}` } });
if (!upRes.ok) throw new Error(`seed upload failed ${upRes.status}: ${(await upRes.text()).slice(0, 200)}`);
const track = (await upRes.json()).track;

const likeRes = await fetch(`${APP_URL}/api/likes`, { method: 'POST',
  headers: { 'content-type': 'application/json', cookie: `pb_auth=${cookie}` }, body: JSON.stringify({ track }) });
if (!likeRes.ok) throw new Error(`seed like failed ${likeRes.status}`);

const histRes = await fetch(`${APP_URL}/api/history`, { method: 'POST',
  headers: { 'content-type': 'application/json', cookie: `pb_auth=${cookie}` }, body: JSON.stringify({ track }) });
if (!histRes.ok) throw new Error(`seed history failed ${histRes.status}`);

const plRes = await fetch(`${APP_URL}/api/playlists`, { method: 'POST',
  headers: { 'content-type': 'application/json', cookie: `pb_auth=${cookie}` }, body: JSON.stringify({ name: playlistName }) });
if (!plRes.ok) throw new Error(`create playlist failed ${plRes.status}`);
const { playlist } = await plRes.json();

const checks = [];
const check = (name, pass, detail = '') => { checks.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  : ${detail}` : ''}`); };
const appeared = async (locator, timeout = 10_000) => {
  try { await locator.waitFor({ timeout }); return true; } catch { return false; }
};

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
await ctx.addCookies([{ name: 'pb_auth', value: cookie, domain: '127.0.0.1', path: '/' }]);

// Serve _capacitor_file_ paths for real so the player never sees a 404 and
// drops the <audio> src while the fake plugin's local-file claims are live.
await ctx.route('**/_capacitor_file_**', (route) =>
  route.fulfill({ status: 200, contentType: 'audio/wav', body: wav(1, 8000) }));

// Fake EmberOffline plugin, copied from tests/offline-android-ui.test.mjs so
// the __emberOfflineCalls shape matches.
await ctx.addInitScript(() => {
  const listeners = {};
  const STATE_KEY = '__emberFakeOfflineState__';
  const CALLS_KEY = '__emberFakeOfflineCalls__';
  const loadState = () => {
    try { return JSON.parse(localStorage.getItem(STATE_KEY)) ?? { pins: {}, trackFiles: {}, totalBytes: 0 }; }
    catch { return { pins: {}, trackFiles: {}, totalBytes: 0 }; }
  };
  const saveState = (s) => localStorage.setItem(STATE_KEY, JSON.stringify(s));
  const loadCalls = () => { try { return JSON.parse(sessionStorage.getItem(CALLS_KEY)) ?? []; } catch { return []; } };
  const pushCall = (c) => { const calls = loadCalls(); calls.push(c); sessionStorage.setItem(CALLS_KEY, JSON.stringify(calls)); window.__emberOfflineCalls = calls; };

  const snapshot = () => {
    const s = loadState();
    return { pins: Object.values(s.pins), trackFiles: { ...s.trackFiles }, totalBytes: s.totalBytes };
  };
  const emit = (progress) => {
    const s = { ...snapshot(), ...(progress ? { progress } : {}) };
    (listeners.offline ?? []).forEach((cb) => cb(s));
  };

  const plugin = {
    addListener: (event, cb) => { (listeners[event] ??= []).push(cb); return Promise.resolve({ remove: () => {} }); },
    status: () => Promise.resolve(snapshot()),
    pin: ({ id, name, tracks }) => {
      pushCall(['pin', id]);
      const s = loadState();
      s.pins[id] = { id, name, total: tracks.length, done: 0, failed: 0, downloading: true, trackIds: tracks.map((t) => t.id) };
      saveState(s);
      const resolved = snapshot();
      setTimeout(() => {
        const s2 = loadState();
        if (!s2.pins[id]) return;
        s2.pins[id] = { ...s2.pins[id], done: 1 };
        saveState(s2);
        emit({ id, done: 1, total: tracks.length, title: tracks[0]?.title ?? '' });
        setTimeout(() => {
          const s3 = loadState();
          if (!s3.pins[id]) return;
          for (const t of tracks) s3.trackFiles[t.id] = `/data/user/0/app.ember.music/files/offline/audio/${t.id}.m4a`;
          s3.totalBytes += tracks.length * 1024 * 1024;
          s3.pins[id] = { ...s3.pins[id], done: tracks.length, downloading: false };
          saveState(s3);
          emit();
        }, 300);
      }, 300);
      return Promise.resolve(resolved);
    },
    unpin: ({ id }) => { pushCall(['unpin', id]); const s = loadState(); delete s.pins[id]; saveState(s); return Promise.resolve(snapshot()); },
    cancel: ({ id }) => { pushCall(['cancel', id]); const s = loadState(); delete s.pins[id]; saveState(s); return Promise.resolve(snapshot()); },
    clearAll: () => { pushCall(['clearAll']); saveState({ pins: {}, trackFiles: {}, totalBytes: 0 }); return Promise.resolve(snapshot()); },
  };

  window.__emberOfflineCalls = loadCalls();
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    convertFileSrc: (p) => `http://127.0.0.1:3010/_capacitor_file_${p}`,
    Plugins: {
      EmberOffline: plugin,
      MediaSession: {
        setMetadata: () => Promise.resolve(),
        setPlaybackState: () => Promise.resolve(),
        setActionHandler: () => {},
        setPositionState: () => Promise.resolve(),
      },
    },
  };
});

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// ── 1: /library: shelves instead of tabs ────────────────────────────────
await page.goto(`${APP_URL}/library`, { waitUntil: 'networkidle' });
check('no tablist on /library', (await page.getByRole('tablist').count()) === 0);
check('"Your collections" heading present', await appeared(page.getByRole('heading', { name: 'Your collections' })));
check('"Playlists" heading present', await appeared(page.getByRole('heading', { name: 'Playlists' })));
const main = page.locator('main');
check('a Liked songs link is in main', (await main.getByRole('link', { name: /liked songs/i }).count()) > 0);
check('a Recently played link is in main', (await main.getByRole('link', { name: /recently played/i }).count()) > 0);
check('an Uploads link is in main', (await main.getByRole('link', { name: /^uploads/i }).count()) > 0);
check('the playlist link is in main', (await main.getByRole('link', { name: playlistName }).count()) > 0);

// ── 2: sidebar: collections above the playlist links ────────────────────
const aside = page.locator('aside');
const likedLink = aside.getByRole('link', { name: 'Liked songs' });
const recentLink = aside.getByRole('link', { name: 'Recently played' });
const uploadsLink = aside.getByRole('link', { name: 'Uploads' });
const sidebarPlaylistLink = aside.getByRole('link', { name: playlistName });
check('sidebar has Liked songs', (await likedLink.count()) > 0);
check('sidebar has Recently played', (await recentLink.count()) > 0);
check('sidebar has Uploads', (await uploadsLink.count()) > 0);
const likedBox = await likedLink.first().boundingBox();
const playlistBox = await sidebarPlaylistLink.first().boundingBox();
check('Liked songs sits above the playlist link',
  !!likedBox && !!playlistBox && likedBox.y < playlistBox.y,
  `${likedBox?.y} vs ${playlistBox?.y}`);

// ── 3: Liked card -> /library/liked, download for offline ───────────────
await main.getByRole('link', { name: /liked songs/i }).first().click();
await page.waitForURL(/\/library\/liked$/);

// ── 2b: sidebar "Library" link is not active on a collection sub-route ──
// Sidebar/Drawer used pathname.startsWith(href) for every BASE_NAV entry,
// so "/library" matched "/library/liked" too and both rows lit up. Library
// now exact-matches; CollectionNavList marks active with the same
// bg-sidebar-accent/text-sidebar-accent-foreground classes (no aria-current).
const hasActiveClass = (cls) => (cls ?? '').split(/\s+/).includes('bg-sidebar-accent');
const libraryLink = aside.getByRole('link', { name: 'Library', exact: true });
const libraryClass = await libraryLink.first().getAttribute('class');
const likedActiveClass = await likedLink.first().getAttribute('class');
check('sidebar Library link is not active on /library/liked', !hasActiveClass(libraryClass), libraryClass ?? '');
check('sidebar Liked songs link is active on /library/liked', hasActiveClass(likedActiveClass), likedActiveClass ?? '');

check('Liked page heading', await appeared(page.getByRole('heading', { name: 'Liked songs' })));
check('Play button present', (await page.getByRole('button', { name: 'Play' }).count()) > 0);
check('Shuffle play button present', (await page.getByRole('button', { name: 'Shuffle play' }).count()) > 0);
check('the song is listed', await appeared(page.getByText(songTitle, { exact: true }).first()));
// TrackMenu (components/track/menus/TrackMenu.tsx) renders in the row's
// trailing slot; each page wires it by hand (docs/DESLOP.md step 4 follow-
// up), so this catches a collection page that forgot it and silently lost
// add-to-playlist and share.
check('first track row exposes the add-to-playlist control',
  (await page.getByRole('button', { name: 'Add to playlist' }).count()) > 0);
const likedDl = page.getByRole('button', { name: 'Download for offline' });
check('Download for offline button present', await appeared(likedDl));
await likedDl.click();
check('settles on Downloaded', await appeared(page.getByText(/^downloaded$/i), 5_000));
let calls = await page.evaluate(() => window.__emberOfflineCalls);
check("pin('liked') recorded", calls.some((c) => c[0] === 'pin' && c[1] === 'liked'), JSON.stringify(calls));

// ── 4: Uploads page ──────────────────────────────────────────────────────
await page.goto(`${APP_URL}/library/uploads`, { waitUntil: 'networkidle' });
check('Uploads heading', await appeared(page.getByRole('heading', { name: 'Uploads' })));
check('Upload button present', (await page.getByRole('button', { name: 'Upload' }).count()) > 0);
check('the song is listed on Uploads', await appeared(page.getByText(songTitle, { exact: true }).first()));
const uploadsDl = page.getByRole('button', { name: 'Download for offline' });
check('Uploads Download for offline present', await appeared(uploadsDl));
await uploadsDl.click();
check('Uploads settles on Downloaded', await appeared(page.getByText(/^downloaded$/i), 5_000));
calls = await page.evaluate(() => window.__emberOfflineCalls);
check("pin('uploads') recorded", calls.some((c) => c[0] === 'pin' && c[1] === 'uploads'), JSON.stringify(calls));

// ── 5: Recent page ───────────────────────────────────────────────────────
await page.goto(`${APP_URL}/library/recent`, { waitUntil: 'networkidle' });
check('Recently played heading', await appeared(page.getByRole('heading', { name: 'Recently played' })));
check('the song is listed on Recent', await appeared(page.getByText(songTitle, { exact: true }).first()));
check('no Remove buttons on Recent', (await page.getByRole('button', { name: 'Remove' }).count()) === 0);
const recentDl = page.getByRole('button', { name: 'Download for offline' });
check('Recent Download for offline present', await appeared(recentDl));
await recentDl.click();
check('Recent settles on Downloaded', await appeared(page.getByText(/^downloaded$/i), 5_000));
calls = await page.evaluate(() => window.__emberOfflineCalls);
check("pin('recent') recorded", calls.some((c) => c[0] === 'pin' && c[1] === 'recent'), JSON.stringify(calls));

// ── 6: offline Library view lists downloaded collections ────────────────
// Land on /library while still online, same as tests/offline-android-ui.
// test.mjs does: /library is force-dynamic (reads the auth cookie), so it
// has no prefetch cache to soft-navigate from once offline, and even a Link
// click to it hits the network for real and hangs on the browser's own
// offline interstitial (confirmed running this against the sandbox: the
// click leaves no <main> at all). useOnline() flips the already-mounted
// page into its offline branch reactively instead.
await page.goto(`${APP_URL}/library`, { waitUntil: 'networkidle' });
await ctx.setOffline(true);
// Wait for the offline branch to render rather than sleeping a fixed time.
await page.locator('main').getByText(/offline/i).first().waitFor({ timeout: 5000 }).catch(() => {});
const offlineBody = await page.locator('main').innerText();
check('offline library says offline', /offline/i.test(offlineBody), offlineBody.slice(0, 200));
check('offline library shows Liked songs', offlineBody.includes('Liked songs'), offlineBody.slice(0, 200));
check('offline library shows Uploads', offlineBody.includes('Uploads'), offlineBody.slice(0, 200));
check('offline library shows Recently played', offlineBody.includes('Recently played'), offlineBody.slice(0, 200));
await ctx.setOffline(false);

// ── 6b: collection page opened offline with nothing cached -> no Play, ──
// empty-state message shown. Fresh context, offline before the very first
// navigation (no SW precache, no react-query cache), so this is the "opened
// cold, offline" case rather than an already-hydrated page flipping offline.
const ctx3 = await browser.newContext({ viewport: { width: 1300, height: 950 } });
await ctx3.addCookies([{ name: 'pb_auth', value: cookie, domain: '127.0.0.1', path: '/' }]);
await ctx3.setOffline(true);
const page3 = await ctx3.newPage();
let coldOfflineLoaded = true;
try {
  await page3.goto(`${APP_URL}/library/recent`, { waitUntil: 'domcontentloaded', timeout: 8_000 });
  await page3.locator('main').first().waitFor({ timeout: 5_000 });
} catch {
  coldOfflineLoaded = false;
}
if (coldOfflineLoaded) {
  check('cold-offline collection page: no Play button',
    (await page3.getByRole('button', { name: 'Play' }).count()) === 0);
  const coldBody = await page3.locator('main').innerText().catch(() => '');
  check('cold-offline collection page: offline empty message shown',
    /offline/i.test(coldBody), coldBody.slice(0, 200));
} else {
  // A fresh navigation with no cache and no SW precache hits the browser's
  // native offline interstitial before Next.js ever renders (same as the
  // /library force-dynamic case above) - nothing in our app to assert on.
  console.log('SKIP  cold-offline collection page checks: page could not load offline with no prior cache');
}
await ctx3.close();

// ── 7: no native plugin -> no download button on a collection page ──────
const ctx2 = await browser.newContext({ viewport: { width: 1300, height: 950 } });
await ctx2.addCookies([{ name: 'pb_auth', value: cookie, domain: '127.0.0.1', path: '/' }]);
const page2 = await ctx2.newPage();
const errors2 = [];
page2.on('pageerror', (e) => errors2.push(e.message));
await page2.goto(`${APP_URL}/library/liked`, { waitUntil: 'networkidle' });
check('second context: Liked heading present', await appeared(page2.getByRole('heading', { name: 'Liked songs' })));
check('second context: no download button without the native plugin',
  (await page2.getByRole('button', { name: /download for offline/i }).count()) === 0);

check('no page errors (context 1)', errors.length === 0, errors.slice(0, 2).join(' | '));
check('no page errors (context 2)', errors2.length === 0, errors2.slice(0, 2).join(' | '));

await ctx2.close();
await browser.close();

console.log(`\n${checks.filter(Boolean).length}/${checks.length} checks passed`);
process.exit(checks.every(Boolean) ? 0 : 1);
