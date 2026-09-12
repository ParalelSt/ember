/** The web UI against a FAKE native Android player.
 *
 *      node tests/android-player-ui.test.mjs      # or: npm run test:android-ui
 *
 *  Proves the provider hands the queue to the native player and mirrors what
 *  the native player reports, without a phone: a fake `EmberPlayer` plugin is
 *  injected before the app loads. Sandbox from tests/README.md (PB 8091,
 *  app 3010). */
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
  for (const d of fs.readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const found = execSync(`find "${path.join(root, d)}" -maxdepth 6 -type f \\( -name "Google Chrome for Testing" -o -name "Chromium" \\) 2>/dev/null | head -1`, { encoding: 'utf8' }).trim();
    if (found) return found;
  }
  throw new Error('no Chromium; set CHROME_PATH');
}
async function adminToken() {
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const r = await fetch(`${PB_URL}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: 'admin@ember.com', password: 'egKa5WNMx3QpuG7' }) });
    if (r.ok) return (await r.json()).token;
  }
  throw new Error('no PB admin');
}
const token = await adminToken();
const email = `auto-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
await fetch(`${PB_URL}/api/collections/users/records`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: token },
  body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name: 'Auto Tester', verified: true }) });
const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identity: email, password: PASSWORD }) }).then((r) => r.json());
const cookie = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));

function wav(seconds = 120, rate = 8000) {
  const n = seconds * rate; const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2);
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const titles = [`Auto Song A ${Date.now()}`, `Auto Song B ${Date.now()}`];
for (const t of [...titles].reverse()) {           // B first, so A is newest and lists first
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(wav())], { type: 'audio/wav' }), 'a.wav');
  form.append('title', t); form.append('artist', 'Auto Tester');
  const r = await fetch(`${APP_URL}/api/uploads`, { method: 'POST', body: form, headers: { cookie: `pb_auth=${cookie}` } });
  if (!r.ok) throw new Error(`seed failed ${r.status}`);
}

const checks = [];
const check = (name, pass, detail = '') => { checks.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`); };

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
await ctx.addCookies([{ name: 'pb_auth', value: cookie, domain: '127.0.0.1', path: '/' }]);
// The fake native player. Records every call; `window.__emberNativeEmit` lets
// the test act as the phone's native side.
await ctx.addInitScript(() => {
  const listeners = {};
  const calls = [];
  const plugin = {
    addListener: (event, cb) => { (listeners[event] ??= []).push(cb); return Promise.resolve({ remove: () => {} }); },
    setQueue: (o) => { calls.push(['setQueue', o]); return Promise.resolve(); },
    play: () => { calls.push(['play']); return Promise.resolve(); },
    pause: () => { calls.push(['pause']); return Promise.resolve(); },
    seek: (o) => { calls.push(['seek', o]); return Promise.resolve(); },
    next: () => { calls.push(['next']); return Promise.resolve(); },
    prev: () => { calls.push(['prev']); return Promise.resolve(); },
    setVolume: (o) => { calls.push(['setVolume', o]); return Promise.resolve(); },
    getState: () => Promise.resolve({ playing: false, position: 0, duration: 0, index: -1, trackId: null }),
  };
  window.__emberCalls = calls;
  window.__emberNativeEmit = (event, data) => (listeners[event] ?? []).forEach((cb) => cb(data));
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { EmberPlayer: plugin } };
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// Uploads is its own page now (the library rewrite replaced the tabs).
await page.goto(`${APP_URL}/library/uploads`, { waitUntil: 'networkidle' });
await page.getByText(titles[0], { exact: true }).first().click({ clickCount: 2 });
await page.waitForTimeout(1500);

const calls = () => page.evaluate(() => window.__emberCalls);
let c = await calls();
const setQ = c.find((x) => x[0] === 'setQueue');
check('playing a song hands the queue to the native player', !!setQ, JSON.stringify(c.map((x) => x[0])));
check('the queue starts at the clicked song with play=true',
  !!setQ && setQ[1].play === true && setQ[1].tracks?.[setQ[1].index]?.title === titles[0],
  setQ ? `index ${setQ[1].index} of ${setQ[1].tracks?.length}` : '');

// Native reports progress: the bar must show it without any <audio> element.
await page.evaluate((title) => window.__emberNativeEmit('state', { playing: true, position: 42, duration: 120, index: 0, trackId: null }), titles[0]);
await page.waitForTimeout(600);
const barText = await page.locator('footer').innerText();
check('native position shows in the player bar', /0:42/.test(barText), barText.replace(/\s+/g, ' ').slice(0, 120));
check('native playing state shows as Pause', (await page.getByRole('button', { name: 'Pause' }).count()) > 0);

await page.getByRole('button', { name: 'Pause' }).first().click();
await page.waitForTimeout(300);
c = await calls();
check('pause forwards to the native player', c.some((x) => x[0] === 'pause'));

await page.getByRole('button', { name: 'Next' }).first().click();
await page.waitForTimeout(300);
c = await calls();
check('next forwards to the native player (no JS advance)', c.some((x) => x[0] === 'next'));

// The car built its own queue: the UI must show it, and must not push it back.
const before = (await calls()).filter((x) => x[0] === 'setQueue').length;
await page.evaluate(() => window.__emberNativeEmit('queue', {
  index: 1,
  tracks: [
    { id: 'upload:carA', source: 'upload', sourceId: 'carA', title: 'Car Pick One', artist: 'Car', artistId: null, album: null, albumId: null, durationSec: 100, artworkUrl: null, streamUrl: '/api/uploads/carA/stream' },
    { id: 'upload:carB', source: 'upload', sourceId: 'carB', title: 'Car Pick Two', artist: 'Car', artistId: null, album: null, albumId: null, durationSec: 100, artworkUrl: null, streamUrl: '/api/uploads/carB/stream' },
  ],
}));
await page.waitForTimeout(800);
const footer = await page.locator('footer').innerText();
check('a queue built in the car replaces the visible queue', /Car Pick Two/.test(footer), footer.replace(/\s+/g, ' ').slice(0, 100));
const after = (await calls()).filter((x) => x[0] === 'setQueue').length;
check('and is not echoed back to the native player', after === before, `${before} -> ${after}`);

// Native advanced on its own (song ended): the UI follows the index.
await page.evaluate(() => window.__emberNativeEmit('state', { playing: true, position: 1, duration: 100, index: 0, trackId: 'upload:carA' }));
await page.waitForTimeout(600);
check('a native track change moves the UI to that song', /Car Pick One/.test(await page.locator('footer').innerText()));

// A native error must not leave the bar stuck on "paused" while the player
// keeps going: the next state event has to win.
await page.evaluate(() => window.__emberNativeEmit('error', { message: 'Source error' }));
await page.waitForTimeout(300);
await page.evaluate(() => window.__emberNativeEmit('state', { playing: true, position: 5, duration: 100, index: 0, trackId: 'upload:carA' }));
await page.waitForTimeout(600);
check('a native error does not pin the UI to paused', (await page.getByRole('button', { name: 'Pause' }).count()) > 0);
await page.evaluate(() => window.__emberNativeEmit('state', { playing: false, position: 5, duration: 100, index: 0, trackId: 'upload:carA' }));
await page.waitForTimeout(600);
check('a native pause still shows as Play', (await page.getByRole('button', { name: 'Play' }).count()) > 0);

check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close();
console.log(`\n${checks.filter(Boolean).length}/${checks.length} checks passed`);
process.exit(checks.every(Boolean) ? 0 : 1);
