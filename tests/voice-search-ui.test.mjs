/** Voice search reaches the search box through every adapter.
 *
 *      node tests/voice-search-ui.test.mjs      # or: npm run test:voice-ui
 *
 *  Headless Chromium has no microphone, so each run swaps the recognizer for
 *  a fake injected before the app loads, then plays the recognizer's part
 *  and checks that the search box fills from partial and final results and
 *  the mic stops pulsing at the end:
 *   - web: a fake window.webkitSpeechRecognition (the browser path, which
 *     must behave exactly as before native voice search)
 *   - capacitor: a fake window.Capacitor with the EmberSpeech plugin
 *     (partial/final/error/end listeners, start({ lang }))
 *   - tauri: a fake window.__TAURI_INTERNALS__ answering speech_available /
 *     speech_start and emitting speech:* events the way @tauri-apps/api
 *     delivers them (plugin:event|listen + transformCallback)
 *  plus the old-shell cases: a Capacitor shell without the plugin and a
 *  desktop build without the commands both say "Update the Ember app".
 *
 *  Needs the sandbox app (APP_URL, default :3050) and its PocketBase
 *  (PB_URL, default :8088), and playwright-core. CHROME_PATH picks a browser. */
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

const PB = process.env.PB_URL ?? 'http://127.0.0.1:8088';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:3050';
const PASSWORD = 'VoiceTest2026!';

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
    const r = await fetch(PB + p, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: 'admin@ember.com', password: 'egKa5WNMx3QpuG7' }) });
    if (r.ok) return (await r.json()).token;
  }
  throw new Error('could not authenticate as PB admin');
}

const token = await adminToken();
const email = `voice-search-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
const created = await fetch(`${PB}/api/collections/users/records`, { method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: token },
  body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name: 'Voice Search Tester', verified: true }) });
if (!created.ok) throw new Error(`could not create test user: ${created.status}`);
const auth = await fetch(`${PB}/api/collections/users/auth-with-password`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PASSWORD }) })
  .then((r) => r.json());
const cookie = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` : ${detail}` : ''}`);
};

// ---- Fakes, injected before any app script runs. Each exposes
// window.__voice = { calls: [...], partial(t), final(t), end() }.

function fakeWeb() {
  const calls = [];
  let rec = null;
  const results = (parts) => {
    const r = { length: parts.length };
    parts.forEach(([t, f], i) => { r[i] = { isFinal: f, 0: { transcript: t } }; });
    return { resultIndex: 0, results: r };
  };
  // Current Chromium has the unprefixed ctor too, which the app prefers.
  window.SpeechRecognition = window.webkitSpeechRecognition = class {
    constructor() { rec = this; }
    start() { calls.push(['start', this.lang, this.interimResults, this.continuous]); }
    stop() { calls.push(['stop']); }
    abort() { calls.push(['abort']); }
  };
  window.__voice = {
    calls,
    partial: (t) => rec.onresult(results([[t, false]])),
    final: (t) => rec.onresult(results([[t, true]])),
    end: () => rec.onend(),
  };
}

function fakeCapacitor(withPlugin) {
  const calls = [];
  const listeners = {};
  const EmberSpeech = {
    addListener(name, cb) {
      listeners[name] = cb;
      return Promise.resolve({ remove() { delete listeners[name]; } });
    },
    available: () => Promise.resolve({ available: true, onDevice: true }),
    start(o) { calls.push(['start', o.lang]); return Promise.resolve(); },
    stop() { calls.push(['stop']); return Promise.resolve(); },
    abort() { calls.push(['abort']); return Promise.resolve(); },
  };
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    // Only EmberSpeech: every other plugin reads as missing, which the app
    // already treats as "not this shell's feature".
    Plugins: withPlugin ? { EmberSpeech } : {},
  };
  window.__voice = {
    calls,
    partial: (t) => listeners.partial?.({ text: t }),
    final: (t) => listeners.final?.({ text: t }),
    end: () => listeners.end?.({}),
  };
}

function fakeTauri(withCommands) {
  const calls = [];
  const callbacks = {};
  const byEvent = {};
  let nextId = 1;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    transformCallback(cb) { const id = nextId++; callbacks[id] = cb; return id; },
    invoke(cmd, args) {
      if (cmd === 'plugin:event|listen') {
        (byEvent[args.event] ??= []).push(args.handler);
        return Promise.resolve(nextId++);
      }
      if (cmd.startsWith('speech_')) {
        calls.push([cmd, args?.lang]);
        if (!withCommands) return Promise.reject(`Command ${cmd} not found`);
        if (cmd === 'speech_available') return Promise.resolve({ available: true, onDevice: true });
      }
      return Promise.resolve(null);
    },
  };
  const emit = (event, payload) => {
    for (const id of byEvent[event] ?? []) callbacks[id]?.({ event, id: 0, payload });
  };
  window.__voice = {
    calls,
    partial: (t) => emit('speech:partial', { text: t }),
    final: (t) => emit('speech:final', { text: t }),
    end: () => emit('speech:end', {}),
  };
}

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });

async function openPage(init, arg) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
  await ctx.addCookies([{ name: 'pb_auth', value: cookie, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(init, arg);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${APP}/`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Home' }).first().waitFor({ timeout: 10000 });
  // The server HTML has the mic button before React attaches its handler.
  await page.waitForFunction(() => {
    const b = document.querySelector('button[title="Search by voice"]');
    return !!b && Object.keys(b).some((k) => k.startsWith('__reactProps'));
  }, null, { timeout: 10000 });
  return { ctx, page, errors };
}

const box = (page) => page.getByRole('combobox', { name: 'Search' }).or(page.getByRole('textbox', { name: 'Search' })).first();
const mic = (page) => page.locator('button[title="Search by voice"]').first();

async function speakThrough(label, init, arg, expectedStart) {
  const { ctx, page, errors } = await openPage(init, arg);
  await mic(page).click();
  await page.waitForFunction(() => window.__voice.calls.some((c) => c[0] === 'start' || c[0] === 'speech_start'),
    null, { timeout: 5000 }).catch(() => {});
  const calls = await page.evaluate(() => window.__voice.calls);
  const start = calls.find((c) => c[0] === 'start' || c[0] === 'speech_start');
  check(`${label}: the mic starts the recognizer`, !!start && expectedStart(start), JSON.stringify(calls));
  check(`${label}: the mic pulses while listening`, (await mic(page).getAttribute('aria-pressed')) === 'true');

  await page.evaluate(() => window.__voice.partial('daft pu'));
  await page.waitForTimeout(100);
  check(`${label}: a partial result fills the search box`, (await box(page).inputValue()) === 'daft pu',
    await box(page).inputValue());

  await page.evaluate(() => { window.__voice.final('daft punk'); window.__voice.end(); });
  await page.waitForTimeout(150);
  check(`${label}: the final result fills the search box`, (await box(page).inputValue()) === 'daft punk',
    await box(page).inputValue());
  check(`${label}: the mic stops pulsing at the end`, (await mic(page).getAttribute('aria-pressed')) === 'false');
  check(`${label}: no page errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

async function oldShell(label, init, arg) {
  const { ctx, page, errors } = await openPage(init, arg);
  await mic(page).click();
  const toast = page.getByText('Update the Ember app to use voice search.');
  const shown = await toast.first().waitFor({ timeout: 5000 }).then(() => true, () => false);
  check(`${label}: the mic asks for an app update`, shown);
  check(`${label}: the mic does not stay pulsing`, (await mic(page).getAttribute('aria-pressed')) === 'false');
  check(`${label}: no page errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

const lang = (s) => typeof s === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(s);

await speakThrough('web', fakeWeb, undefined,
  (c) => lang(c[1]) && c[2] === true && c[3] === false);
await speakThrough('capacitor', fakeCapacitor, true, (c) => lang(c[1]));
await speakThrough('tauri', fakeTauri, true, (c) => lang(c[1]));
await oldShell('old APK (no EmberSpeech plugin)', fakeCapacitor, false);
await oldShell('old desktop build (no speech_* commands)', fakeTauri, false);

await browser.close();

const failed = checks.filter(([, p]) => !p);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map(([n]) => n).join(', '));
process.exit(failed.length ? 1 : 0);
