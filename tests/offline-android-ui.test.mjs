/** The web UI against a FAKE native EmberOffline plugin.
 *
 *      node tests/offline-android-ui.test.mjs      # or: npm run test:offline-ui
 *
 *  Proves the web app routes downloads through the native offline plugin when
 *  it is present, plays downloaded tracks from the local file the plugin
 *  reports, gates the Liked "Download for offline" button on the plugin's
 *  presence, renders the offline Library from native pins, and that Settings
 *  → Downloads lists pins and can clear them. No phone: a fake `EmberOffline`
 *  plugin is injected before the app loads (same trick as
 *  tests/android-player-ui.test.mjs on the android-auto branch, for
 *  EmberPlayer). Sandbox from tests/README.md (PB 8091, app 3010). */
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
const email = `offline-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
await fetch(`${PB_URL}/api/collections/users/records`, { method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: token },
  body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name: 'Offline Tester', verified: true }) });
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

// Seed two uploaded tracks: the playlist gets both, the first is liked too.
const titles = [`Offline Song A ${Date.now()}`, `Offline Song B ${Date.now()}`];
const uploaded = [];
for (const t of titles) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(wav())], { type: 'audio/wav' }), 'a.wav');
  form.append('title', t);
  form.append('artist', 'Offline Tester');
  const r = await fetch(`${APP_URL}/api/uploads`, { method: 'POST', body: form, headers: { cookie: `pb_auth=${cookie}` } });
  if (!r.ok) throw new Error(`seed failed ${r.status}: ${(await r.text()).slice(0, 200)}`);
  uploaded.push((await r.json()).track);
}

const playlistName = `Offline Playlist ${Date.now()}`;
const plRes = await fetch(`${APP_URL}/api/playlists`, { method: 'POST',
  headers: { 'content-type': 'application/json', cookie: `pb_auth=${cookie}` }, body: JSON.stringify({ name: playlistName }) });
if (!plRes.ok) throw new Error(`create playlist failed ${plRes.status}`);
const { playlist } = await plRes.json();
for (const track of uploaded) {
  const r = await fetch(`${APP_URL}/api/playlists/${playlist.id}/tracks`, { method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `pb_auth=${cookie}` }, body: JSON.stringify({ track }) });
  if (!r.ok) throw new Error(`add-to-playlist failed ${r.status}`);
}

const checks = [];
const check = (name, pass, detail = '') => { checks.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  : ${detail}` : ''}`); };

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
await ctx.addCookies([{ name: 'pb_auth', value: cookie, domain: '127.0.0.1', path: '/' }]);

// On a real phone, Capacitor's webview scheme handler serves
// _capacitor_file_ paths locally: no HTTP round trip, so it never 404s. Here
// that URL hits our sandbox's Next.js server for real, and a 404 would fire
// the <audio> element's error handler, which drops the src (so the local-
// playback proof would flap on whether the network round trip beat the
// assertion). Serve real audio bytes for it instead, standing in for the
// native scheme handler.
await ctx.route('**/_capacitor_file_**', (route) =>
  route.fulfill({ status: 200, contentType: 'audio/wav', body: wav(1, 8000) }));

// The fake EmberOffline plugin. Keeps its own pins/trackFiles in memory,
// resolves `pin` immediately with done=0, then emits two `offline` events
// 300ms apart: one partial (downloading, progress), one complete (trackFiles
// filled). Also stubs convertFileSrc and a no-op MediaSession, since setting
// isNativePlatform() true routes the player onto the capacitor audio backend
// which calls MediaSession and would otherwise throw.
await ctx.addInitScript(() => {
  const listeners = {};
  // A real EmberOffline plugin lives in the Android process, outside the
  // WebView, so its pins survive a page reload untouched. This fake runs as
  // page JS instead, and `addInitScript` re-injects (fresh closure) on every
  // navigation, so its state is kept in localStorage/sessionStorage, which
  // DO survive a reload, to match that real persistence.
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
        if (!s2.pins[id]) return; // unpinned/cleared before this landed
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

// ── 1: playlist page: download for offline ─────────────────────────────
await page.goto(`${APP_URL}/playlist/${playlist.id}`, { waitUntil: 'networkidle' });
await page.getByRole('heading', { name: playlistName }).waitFor({ timeout: 10_000 });
const dlButton = page.getByRole('button', { name: /download for offline/i });
await dlButton.waitFor({ timeout: 10_000 });
check('the playlist page shows Download for offline', true);
await dlButton.click();
await page.getByText(/downloading/i).waitFor({ timeout: 5_000 });
check('clicking it shows Downloading…', true);
await page.getByText(/^downloaded$/i).waitFor({ timeout: 5_000 });
check('it settles on Downloaded', true);

// ── 2: Liked tab: like a track, then the Liked download button appears ──
// Liked via the raw API (as the browser page never mounted a heart button
// for it), so reload rather than client-navigate: react-query's 30s
// staleTime would otherwise keep serving the pre-like empty cache.
await fetch(`${APP_URL}/api/likes`, { method: 'POST',
  headers: { 'content-type': 'application/json', cookie: `pb_auth=${cookie}` }, body: JSON.stringify({ track: uploaded[0] }) });
await page.goto(`${APP_URL}/library`, { waitUntil: 'networkidle' });
await page.getByRole('tab', { name: 'Liked' }).click();
const likedDlButton = page.getByRole('button', { name: /download for offline/i });
await likedDlButton.waitFor({ timeout: 10_000 });
check('the Liked tab shows Download for offline (native plugin present)', true);
await likedDlButton.click();
await page.getByText(/^downloaded$/i).first().waitFor({ timeout: 5_000 });
await page.waitForTimeout(300); // let the pin's localStorage write settle before navigating away

// ── 3: play a downloaded track: audio src is the local file ────────────
await page.goto(`${APP_URL}/playlist/${playlist.id}`, { waitUntil: 'networkidle' });
await page.getByText(titles[0], { exact: true }).first().click({ clickCount: 2 });
await page.waitForTimeout(1000);
const audioSrc = await page.evaluate(() => document.querySelector('audio')?.src ?? null);
check('the downloaded track plays from the local file', !!audioSrc && audioSrc.includes('_capacitor_file_'), audioSrc ?? 'no <audio> element');

// ── 4: offline: library shows the pinned playlist ────────────────────────
// Land on /library while still online ("already loaded page" per the brief).
// /library is force-dynamic (reads the auth cookie), so it has no prefetch
// cache to soft-navigate from once offline: even a Link click to the exact
// current route asks Next's router to re-fetch and hits the network for
// real (ERR_INTERNET_DISCONNECTED, confirmed by running this against the
// sandbox). No navigation is needed to prove the offline view, though:
// `useOnline()` listens for the browser's own `offline` event and flips the
// already-mounted page into its offline branch reactively.
await page.goto(`${APP_URL}/library`, { waitUntil: 'networkidle' });
await ctx.setOffline(true);
await page.waitForTimeout(500);
const offlineBody = await page.locator('main').innerText();
check('offline library says Offline', /offline/i.test(offlineBody), offlineBody.slice(0, 200));
check('offline library shows the pinned playlist by name', offlineBody.includes(playlistName), offlineBody.slice(0, 200));
await ctx.setOffline(false);

// ── 5: Settings → Downloads: rows per pin, clear all ────────────────────
await page.goto(`${APP_URL}/settings/downloads`, { waitUntil: 'networkidle' });
const sizeText = await page.locator('main').innerText();
check('downloads settings shows a non-zero size', !/^0 B/m.test(sizeText.trim()) && /MB|KB|GB/.test(sizeText), sizeText.slice(0, 200));
const pinRows = await page.locator('[data-testid="offline-pins"] li').count();
check('one row per pin', pinRows >= 2, `${pinRows} row(s)`);

await page.getByRole('button', { name: /clear all downloads/i }).click();
await page.getByRole('button', { name: /clear downloads/i }).click();
await page.waitForTimeout(500);
const clearCalled = await page.evaluate(() => window.__emberOfflineCalls.some((c) => c[0] === 'clearAll'));
check("the fake's clearAll was called", clearCalled);
const rowsAfter = await page.locator('[data-testid="offline-pins"] li').count();
check('the page shows 0 pins after clearing', rowsAfter === 0, `${rowsAfter} row(s)`);

check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close();

console.log(`\n${checks.filter(Boolean).length}/${checks.length} checks passed`);
process.exit(checks.every(Boolean) ? 0 : 1);
