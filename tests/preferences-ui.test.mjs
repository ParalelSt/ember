/** Plugin switches follow the account (Settings > Plugins): two browser
 *  contexts stand in for two devices signed in to the same account.
 *
 *      npm i -D playwright-core
 *      node tests/preferences-ui.test.mjs        # or: npm run test:preferences-ui
 *
 *  Device A turns Songsterr integration off and the party volume slider on;
 *  a fresh device B (empty localStorage) shows both that way. B flips them
 *  back; A picks that up on reload. Then an account that never saved its
 *  switches takes them from the first device that loads (the migration).
 *
 *  Needs a sandbox: PocketBase (PB_URL) with pb_hooks/ensure_plugin_settings
 *  loaded, and the app (APP_URL) built from this tree with MUSIC_DIR set
 *  (songs are uploaded wavs). Set CHROME_PATH to pick a browser. */
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

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8091';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3010';
const PASSWORD = 'BugTest2026!';
const SETTINGS_KEY = 'ember.settings.v1';

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
    const res = await fetch(`${PB_URL}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: 'admin@ember.com', password: 'egKa5WNMx3QpuG7' }) });
    if (res.ok) return (await res.json()).token;
  }
  throw new Error('could not authenticate as PB admin');
}

const token = await adminToken();
const run = `${process.pid}-${Math.floor(Math.random() * 1e6)}`;

/** A fresh member, signed in: the pb_auth cookie value. */
async function member(tag) {
  const email = `prefsui-${tag}-${run}@ember.test`;
  await fetch(`${PB_URL}/api/collections/users/records`, { method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: token },
    body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name: `Prefs ${tag}`, verified: true }) });
  const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PASSWORD }) })
    .then((r) => r.json());
  return encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));
}

/** What the account has stored, straight from the route. */
const accountPlugins = (cookie) =>
  fetch(`${APP_URL}/api/plugins`, { headers: { cookie: `pb_auth=${cookie}` } }).then((r) => r.json());

function makeWav(seconds = 180, sampleRate = 8000) {
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

async function uploadSong(cookie, title) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(makeWav())], { type: 'audio/wav' }), 'song.wav');
  form.append('title', title);
  form.append('artist', 'Prefs Tester');
  const res = await fetch(`${APP_URL}/api/uploads`, { method: 'POST', body: form, headers: { cookie: `pb_auth=${cookie}` } });
  if (!res.ok) throw new Error(`could not seed a song: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).track;
}

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });

/** A new "device": its own context, so its own localStorage. */
async function device(cookie, initScript) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
  await ctx.addCookies([{ name: 'pb_auth', value: cookie, domain: new URL(APP_URL).hostname, path: '/' }]);
  if (initScript) await ctx.addInitScript(initScript.fn, initScript.arg);
  return ctx.newPage();
}

async function play(page, title) {
  await page.goto(`${APP_URL}/library/uploads`, { waitUntil: 'networkidle' });
  await page.getByText(title, { exact: true }).first().click({ clickCount: 2 });
  await page.locator('footer').getByRole('button', { name: 'Queue' }).waitFor({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

const guitarButtons = (page) => page.locator('footer').getByRole('button', { name: 'Guitar tabs' }).count();
/** The volume slider's width: 160px with the party slider, 118px without. */
const volumeWidth = (page) => page.evaluate(() => {
  const mute = document.querySelector('footer button[aria-label="Mute"], footer button[aria-label="Unmute"]');
  const box = mute?.nextElementSibling?.getBoundingClientRect();
  return box ? Math.round(box.width) : null;
});
/** aria-pressed of a plugin card's switch, whichever way its label reads. */
const switchOn = (page, name) =>
  page.locator(`button[aria-label="Turn off ${name}"], button[aria-label="Turn on ${name}"]`).first().getAttribute('aria-pressed')
    .then((v) => v === 'true');
const openPlugins = async (page) => {
  await page.goto(`${APP_URL}/settings/plugins`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
};
/** Click a switch and wait for its save to land on the account. */
async function flip(page, label) {
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/plugins') && r.request().method() === 'PATCH', { timeout: 10_000 });
  await page.getByRole('button', { name: label }).click();
  const res = await saved.catch(() => null);
  return res?.status() ?? 0;
}

// ── two devices, one account ──────────────────────────────────────────────
const owner = await member('owner');
const song = await uploadSong(owner, `Prefs Song ${run}`);

const a = await device(owner);
await play(a, song.title);
check('A: the Guitar tabs button is there by default', (await guitarButtons(a)) > 0);
check('A: the normal volume slider by default', (await volumeWidth(a)) === 118, `${await volumeWidth(a)}px`);

await openPlugins(a);
check('A: turning Songsterr integration off saves to the account', (await flip(a, 'Turn off Songsterr integration')) === 200);
check('A: turning the party slider on saves to the account', (await flip(a, 'Turn on Party-size volume slider')) === 200);
{
  const acct = await accountPlugins(owner);
  check('the account holds both switches', acct.tabsEnabled === false && acct.partyVolume === true, JSON.stringify(acct));
}

const b = await device(owner);
await play(b, song.title);
const bGuitarGone = await b.waitForFunction(
  () => !document.querySelector('footer button[aria-label="Guitar tabs"]'), null, { timeout: 8_000 },
).then(() => true, () => false);
check('B: no Guitar tabs button (account says off)', bGuitarGone && (await guitarButtons(b)) === 0);
check('B: the party-size volume slider (account says on)', (await volumeWidth(b)) === 160, `${await volumeWidth(b)}px`);
await openPlugins(b);
check('B: the plugins page shows Songsterr off', (await switchOn(b, 'Songsterr integration')) === false);
check('B: the plugins page shows the party slider on', (await switchOn(b, 'Party-size volume slider')) === true);
{
  const cached = await b.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}').state, SETTINGS_KEY);
  check('B: its local cache now holds the account values', cached?.tabsEnabled === false && cached?.partyVolume === true, JSON.stringify(cached));
}

check('B: turning Songsterr back on saves', (await flip(b, 'Turn on Songsterr integration')) === 200);
check('B: turning the party slider off saves', (await flip(b, 'Turn off Party-size volume slider')) === 200);

await a.reload({ waitUntil: 'networkidle' });
await a.waitForTimeout(1000);
check('A after reload: Songsterr is on again', (await switchOn(a, 'Songsterr integration')) === true);
check('A after reload: the party slider is off again', (await switchOn(a, 'Party-size volume slider')) === false);
await play(a, song.title);
check('A after reload: the Guitar tabs button is back', (await guitarButtons(a)) > 0);
check('A after reload: the normal volume slider is back', (await volumeWidth(a)) === 118, `${await volumeWidth(a)}px`);
await a.context().close();
await b.context().close();

// ── migration: the first device to load writes its local values up ────────
{
  const fresh = await member('migrate');
  const before = await accountPlugins(fresh);
  check('a new account has no plugin switches stored', Object.keys(before).length === 0, JSON.stringify(before));

  // An older build's cache: both switches away from their defaults.
  const c = await device(fresh, {
    fn: ([key, value]) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, value); },
    arg: [SETTINGS_KEY, JSON.stringify({ state: { partyVolume: true, autoReportEnabled: true, tabsEnabled: false }, version: 0 })],
  });
  const migrated = c.waitForResponse((r) => r.url().endsWith('/api/plugins') && r.request().method() === 'PATCH', { timeout: 10_000 })
    .catch(() => null);
  await openPlugins(c);
  const res = await migrated;
  check('the first load writes the local values up', res?.status() === 200);
  const after = await accountPlugins(fresh);
  check('the account now holds this device\'s values', after.partyVolume === true && after.tabsEnabled === false, JSON.stringify(after));
  check('the page still shows them', (await switchOn(c, 'Songsterr integration')) === false
    && (await switchOn(c, 'Party-size volume slider')) === true);
  await c.context().close();

  // A second device with different local values does not overwrite them.
  const d = await device(fresh, {
    fn: ([key, value]) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, value); },
    arg: [SETTINGS_KEY, JSON.stringify({ state: { partyVolume: false, autoReportEnabled: true, tabsEnabled: true }, version: 0 })],
  });
  let patched = false;
  d.on('request', (r) => { if (r.url().endsWith('/api/plugins') && r.method() === 'PATCH') patched = true; });
  await openPlugins(d);
  check('a second device takes the account values over its own cache',
    (await switchOn(d, 'Songsterr integration')) === false && (await switchOn(d, 'Party-size volume slider')) === true);
  check('and writes nothing (first device wins)', !patched);
  await d.context().close();
}

await browser.close();

const failed = checks.filter(([, p]) => !p);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map(([n]) => n).join(', '));
process.exit(failed.length ? 1 : 0);
