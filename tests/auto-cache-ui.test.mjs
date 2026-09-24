/** The web auto cache, end to end: the connection drops mid-queue and the
 *  next cached songs keep playing.
 *
 *      node tests/auto-cache-ui.test.mjs   # or: npm run test:auto-cache-ui
 *
 *  Seeds a user and a playlist of three uploaded songs (A 20 s, B 8 s, C 8 s;
 *  nothing here depends on YouTube), lowers the auto cache's play-time gates
 *  (localStorage 'ember.autoCache.test'), and plays A. Checks that B and C
 *  land in the browser's private storage (OPFS cache/audio), then goes
 *  offline mid-A with every stream request refused, and checks:
 *  - the offline badge shows, and B plays from its cached blob: copy;
 *  - with C's file deleted under the player, the end of B stalls with
 *    "Offline, nothing cached ahead";
 *  - back online, the badge goes away;
 *  - Settings > Downloads shows the cache size and Clear empties it.
 *
 *  Needs a built app and a PocketBase (defaults: app 3053, PB 8086). Set
 *  CHROME_PATH to pick a browser. SHOTS_DIR=<dir> saves screenshots. */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.error('needs playwright-core: npm i -D playwright-core'); process.exit(2); }

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8086';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3053';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL ?? 'admin@ember.com';
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD ?? 'egKa5WNMx3QpuG7';
const SHOTS = process.env.SHOTS_DIR ?? null;
const PASSWORD = 'AutoCache2026!';

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

/** A quiet 440 Hz tone, `seconds` long. */
function makeWav(seconds, sampleRate = 8000) {
  const samples = seconds * sampleRate;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    data.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

async function adminToken() {
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const res = await fetch(`${PB_URL}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: PB_ADMIN_EMAIL, password: PB_ADMIN_PASSWORD }),
    });
    if (res.ok) return (await res.json()).token;
  }
  throw new Error('could not authenticate as PB admin');
}

const token = await adminToken();
const email = `autocache-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
const created = await fetch(`${PB_URL}/api/collections/users/records`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: token },
  body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name: 'Cache Tester', verified: true }),
});
if (!created.ok) throw new Error(`could not create test user: ${created.status} ${await created.text()}`);
const userId = (await created.json()).id;
const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identity: email, password: PASSWORD }),
}).then((r) => r.json());
const cookie = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));
const appFetch = (p, init = {}) =>
  fetch(`${APP_URL}${p}`, { ...init, headers: { ...(init.headers ?? {}), cookie: `pb_auth=${cookie}` } });

async function upload(title, seconds) {
  const form = new FormData();
  form.append('file', new Blob([makeWav(seconds)], { type: 'audio/wav' }), `${title}.wav`);
  form.append('title', title);
  form.append('artist', 'Cache Artist');
  form.append('durationSec', String(seconds));
  const res = await appFetch('/api/uploads', { method: 'POST', body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
}
await upload('Cache A', 20);
await upload('Cache B', 8);
await upload('Cache C', 8);
const { tracks: uploads } = await appFetch('/api/uploads').then((r) => r.json());
const byTitle = (t) => uploads.find((u) => u.title === t);
const [A, B, C] = ['Cache A', 'Cache B', 'Cache C'].map(byTitle);
const { playlist: pl } = await appFetch('/api/playlists', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Cache Mix' }),
}).then((r) => r.json());
for (const track of [A, B, C]) {
  const res = await appFetch(`/api/playlists/${pl.id}/tracks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ track }),
  });
  if (!res.ok) throw new Error(`add to playlist failed: ${res.status} ${await res.text()}`);
}
const fileName = (id) => `${encodeURIComponent(id)}.bin`;

const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
await ctx.addCookies([{ name: 'pb_auth', value: cookie, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  localStorage.setItem('ember.autoCache.test', JSON.stringify({ minPlayedSec: 2, bufferFallbackSec: 3 }));
});
const page = await ctx.newPage();
const prefetches = [];
page.on('request', (r) => { if (r.url().includes('prefetch=1')) prefetches.push(r.url()); });

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name) }); };

/** Names in OPFS cache/audio, or [] before the folder exists. */
const cachedFiles = () => page.evaluate(async () => {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await (await root.getDirectoryHandle('cache')).getDirectoryHandle('audio');
    const out = [];
    for await (const [name] of dir.entries()) out.push(name);
    return out;
  } catch { return []; }
});
const audioState = () => page.evaluate(() => {
  const el = document.querySelector('audio');
  return el ? { src: el.src, time: el.currentTime, dur: el.duration, paused: el.paused, error: el.error?.code ?? null } : null;
});
const waitFor = async (fn, ms, step = 250) => {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > until) return v;
    await page.waitForTimeout(step);
  }
};
const seekNearEnd = () => page.evaluate(() => {
  const el = document.querySelector('audio');
  if (el && Number.isFinite(el.duration)) el.currentTime = Math.max(0, el.duration - 0.6);
});

try {
  await page.goto(`${APP_URL}/playlist/${pl.id}`, { waitUntil: 'networkidle' });
  await page.getByText('Cache A').first().waitFor({ timeout: 15_000 });
  await page.getByText('Cache A').first().dblclick();

  const playing = await waitFor(async () => {
    const a = await audioState();
    return a && !a.paused && a.time > 0.3 ? a : null;
  }, 15_000);
  check('A plays from the stream', !!playing && !playing.src.startsWith('blob:'), playing?.src ?? 'not playing');

  const both = await waitFor(async () => {
    const names = await cachedFiles();
    return names.includes(fileName(B.id)) && names.includes(fileName(C.id)) ? names : null;
  }, 30_000);
  const names = await cachedFiles();
  check('B and C are cached in OPFS while A plays', !!both, names.join(', '));
  check('no half-written .part file is left behind', !names.some((n) => n.endsWith('.part')), names.join(', '));
  check('the cache asked the host with ?prefetch=1', prefetches.length >= 2, `${prefetches.length} prefetch requests`);

  // The connection drops mid-A, and anything that still tries the network fails.
  await ctx.route('**/api/uploads/**', (r) => r.abort());
  await ctx.route('**/api/youtube/stream/**', (r) => r.abort());
  await ctx.setOffline(true);
  const badge = page.getByTestId('offline-badge').first();
  await badge.waitFor({ timeout: 5_000 }).catch(() => {});
  // The desktop pill reads "Offline"; the whole state is its label.
  const badgeText = (await badge.count()) ? await badge.getAttribute('aria-label') : '';
  check('the offline badge shows', /Offline, playing cached songs/.test(badgeText), badgeText || 'no badge');
  await shot('auto-cache-offline-1280.png');
  const summary = await page.getByTestId('player-bar').innerText().catch(() => '');
  check('the song keeps its place beside the pill', summary.includes('Cache A'), summary.split('\n').slice(0, 3).join(' / '));
  // The phone bar spells the state out in place of the artist.
  await page.setViewportSize({ width: 390, height: 844 });
  const phone = await waitFor(async () => {
    const t = await page.getByTestId('phone-player-bar').innerText().catch(() => '');
    return t.includes('Offline, playing cached songs') ? t : null;
  }, 5_000);
  check('the phone bar says it too', !!phone, (phone ?? '').replace(/\n/g, ' / '));
  await shot('auto-cache-offline-390.png');
  await page.setViewportSize({ width: 1280, height: 900 });

  await seekNearEnd();
  const onB = await waitFor(async () => {
    const a = await audioState();
    return a && a.src.startsWith('blob:') && !a.paused && a.time > 0.2 ? a : null;
  }, 10_000);
  check('offline, B plays next from its cached copy', !!onB, JSON.stringify(await audioState()));
  const title = await page.getByTestId('player-bar').innerText().catch(() => '');
  check('the bar shows B beside the badge', title.includes('Cache B') && title.includes('Offline'), title.split('\n').slice(0, 3).join(' / '));

  // C's file disappears under the player (a browser clearing storage, say).
  await page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    const dir = await (await root.getDirectoryHandle('cache')).getDirectoryHandle('audio');
    await dir.removeEntry(name);
  }, fileName(C.id));
  await seekNearEnd();
  const stalled = await waitFor(async () => {
    const b = page.getByTestId('offline-badge').first();
    return (await b.count()) && /nothing cached ahead/.test((await b.getAttribute('aria-label')) ?? '') ? true : null;
  }, 10_000);
  const stalledText = (await page.getByTestId('offline-badge').first().getAttribute('aria-label').catch(() => '')) || 'no badge';
  check('with nothing playable ahead, the badge says so', !!stalled, stalledText);
  const after = await audioState();
  check('and the player stops instead of looping', !!after && after.paused, JSON.stringify(after));
  const toastText = await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => []);
  check('one offline toast', toastText.filter((t) => /no more cached songs/.test(t)).length === 1, toastText.join(' | '));
  await shot('auto-cache-offline-stalled.png');

  await ctx.unroute('**/api/uploads/**');
  await ctx.unroute('**/api/youtube/stream/**');
  await ctx.setOffline(false);
  const gone = await waitFor(async () => ((await page.getByTestId('offline-badge').count()) === 0 ? true : null), 5_000);
  check('back online, the badge goes away', !!gone);
  const resumed = await audioState();
  check('the song it stopped at is loaded, paused', !!resumed && resumed.paused && resumed.src.includes(`/api/uploads/`),
    JSON.stringify(resumed));

  // Settings > Downloads: the two switches, the space used and Clear.
  await page.goto(`${APP_URL}/settings/downloads`, { waitUntil: 'networkidle' });
  const rows = page.getByTestId('auto-cache-settings');
  await rows.waitFor({ timeout: 10_000 });
  const statsText = await page.getByTestId('auto-cache-stats').innerText().catch(() => '');
  check('Settings shows the cache size', /Cached: .*\d+ songs?/.test(statsText), statsText || 'no stats line');
  const clearBtn = page.getByRole('button', { name: 'Clear cached songs' });
  check('Settings has a Clear button', (await clearBtn.count()) === 1 && (await clearBtn.isEnabled()));
  await rows.scrollIntoViewIfNeeded();
  await shot('auto-cache-settings-1280.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await rows.scrollIntoViewIfNeeded();
  await shot('auto-cache-settings-390.png');
  await page.setViewportSize({ width: 1280, height: 900 });
  await clearBtn.click();
  const cleared = await waitFor(async () => {
    const t = await page.getByTestId('auto-cache-stats').innerText().catch(() => '');
    return /Cached: .*0 songs/.test(t) ? t : null;
  }, 5_000);
  check('Clear empties the cache', !!cleared && (await cachedFiles()).length === 0, cleared ?? 'still cached');
} catch (e) {
  check('test ran to the end', false, e.message.split('\n')[0]);
} finally {
  const failed = checks.filter(([, p]) => !p);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  await browser.close();
  await fetch(`${PB_URL}/api/collections/users/records/${userId}`, { method: 'DELETE', headers: { Authorization: token } }).catch(() => {});
  process.exit(failed.length ? 1 : 0);
}
