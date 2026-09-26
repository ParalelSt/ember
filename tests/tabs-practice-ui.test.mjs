/** UI check for the tab page's practice tools (as built): the sync nudge
 *  past 10 s and in beats, the metronome on the
 *  tab's beats through a tempo change, the speed (pitch kept) and the loop,
 *  and the links out of a song with no tab (the places to look, and
 *  Songsterr's versions).
 *
 *      node tests/tabs-practice-ui.test.mjs
 *
 *  Needs the same sandbox as tests/tabs-ui.test.mjs: PocketBase (PB_URL) and
 *  the app (APP_URL) built from this tree with MUSIC_DIR set. Songs are
 *  uploaded wavs. The metronome is heard through a recording AudioContext
 *  put in before the page's scripts, so no sound card is needed. */
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

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = path.join(process.env.HOME ?? '', 'Library/Caches/ms-playwright');
  if (!fs.existsSync(root)) throw new Error('no Playwright browser cache — set CHROME_PATH');
  for (const d of fs.readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const found = execSync(
      `find "${path.join(root, d)}" -maxdepth 6 -type f \\( -name "Google Chrome for Testing" -o -name "Chromium" \\) 2>/dev/null | head -1`,
      { encoding: 'utf8' },
    ).trim();
    if (found) return found;
  }
  throw new Error('no Chromium binary found — set CHROME_PATH');
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

async function member(tag, name) {
  const email = `tabspractice-${tag}-${run}@ember.test`;
  await fetch(`${PB_URL}/api/collections/users/records`, { method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: token },
    body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name, verified: true }) });
  const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PASSWORD }) })
    .then((r) => r.json());
  return encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));
}
const listener = await member('listener', 'Practice Listener');

function makeWav(seconds = 240, sampleRate = 8000) {
  const samples = seconds * sampleRate;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

async function uploadSong(title) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(makeWav())], { type: 'audio/wav' }), 'song.wav');
  form.append('title', title);
  form.append('artist', 'Practice Tester');
  const res = await fetch(`${APP_URL}/api/uploads`, { method: 'POST', body: form, headers: { cookie: `pb_auth=${listener}` } });
  if (!res.ok) throw new Error(`could not seed a song: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).track;
}

/** 48 bars of 4/4: "Intro" at bar 1 and 8 bars at 120 bpm (2 s a bar),
 *  "Verse" at bar 9, then from bar 25 "Chorus" at 60 bpm (4 s a bar). A
 *  Guitar Pro 7 file written by AlphaTab itself. */
async function makeGp() {
  const at = await import(path.join(process.cwd(), 'node_modules/@coderline/alphatab/dist/alphaTab.mjs'));
  const bar = '0.6.4 3.6.4 5.6.4 3.6.4';
  const bars = [];
  for (let i = 0; i < 48; i++) {
    const meta = i === 0 ? '\\section "Intro" ' : i === 8 ? '\\section "Verse" ' : i === 24 ? '\\section "Chorus" \\tempo 60 ' : '';
    bars.push(`${meta}${bar}`);
  }
  const tex = `\\title "Practice Tab"\n\\tempo 120\n\\track ("Guitar" "Gtr")\n\\instrument 30\n\\tuning (E4 B3 G3 D3 A2 E2)\n\\ts (4 4)\n${bars.join(' |\n')}\n`;
  const settings = new at.Settings();
  const imp = new at.importer.AlphaTexImporter();
  imp.initFromString(tex, settings);
  return Buffer.from(new at.exporter.Gp7Exporter().export(imp.readScore(), settings));
}

const song = await uploadSong(`Practice Song ${run}`);
const bare = await uploadSong(`Practice Bare ${run}`);
{
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(await makeGp())]), 'practice.gp');
  form.append('title', song.title);
  form.append('artist', song.artist);
  form.append('trackId', song.id);
  const res = await fetch(`${APP_URL}/api/tabs/files`, { method: 'POST', body: form, headers: { cookie: `pb_auth=${listener}` } });
  if (!res.ok) throw new Error(`could not add the tab: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const consoleErrors = [];
const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });

/** Records every click the metronome schedules: the AudioContext clock
 *  (seconds) each oscillator starts at, and its pitch. */
const RECORDING_AUDIO = () => {
  window.__clicks = [];
  const Real = window.AudioContext;
  window.AudioContext = class extends Real {
    createOscillator() {
      const osc = super.createOscillator();
      const start = osc.start.bind(osc);
      osc.start = (t) => {
        window.__clicks.push({ t, f: osc.frequency.value });
        return start(t);
      };
      return osc;
    }
  };
};

async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([{ name: 'pb_auth', value: listener, domain: new URL(APP_URL).hostname, path: '/' }]);
  await ctx.addInitScript(RECORDING_AUDIO);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  return page;
}

async function play(page, title) {
  await page.goto(`${APP_URL}/library/uploads`, { waitUntil: 'networkidle' });
  await page.getByText(title, { exact: true }).first().click({ clickCount: 2 });
  await page.waitForTimeout(2500);
}
const scoreReady = (page) =>
  page.waitForFunction(() => document.querySelector('[data-testid="tab-score"]')?.dataset.status === 'ready', null, { timeout: 30_000 });
/** The song position straight off the audio element. */
const now = (page) => page.evaluate(() => document.querySelector('audio')?.currentTime ?? -1);
const trackPath = (id) => `/tabs/${encodeURIComponent(id)}`;

{
  const page = await newPage({ width: 1300, height: 950 });
  await play(page, song.title);
  // In-app, so the song keeps playing (a page load would stop it).
  await page.getByRole('button', { name: 'Guitar tabs' }).first().click();
  await page.waitForURL((u) => u.pathname === trackPath(song.id), { timeout: 10_000, waitUntil: 'commit' }).catch(() => {});
  await scoreReady(page).catch(() => {});
  const playing = await page.evaluate(() => !document.querySelector('audio')?.paused);
  check('the song plays on the tab page', playing);
  await page.waitForTimeout(1500);

  // ── sync: past the old 10 s, and in beats ────────────────────────────────
  await page.getByRole('button', { name: 'Sync' }).click();
  await page.getByLabel('Tab timing offset, exact seconds').fill('-95.25');
  const sync = await page.getByRole('button', { name: 'Sync' }).innerText();
  check('the nudge takes -95.25 s (the old limit was 10 s)', /-95\.25 s/.test(sync), sync);
  await page.getByRole('button', { name: 'Reset' }).click();
  await page.getByRole('button', { name: 'beats', exact: true }).click();
  await page.getByLabel('Tab timing offset in beats').fill('4');
  const beats = await page.getByRole('button', { name: 'Sync' }).innerText();
  check('and counts it in beats of the tab (4 beats at 120 bpm)', /\+4 beats/.test(beats), beats);
  const beatNote = await page.getByTestId('tab-sync-beat').innerText().catch(() => '');
  check('it says what a beat is', /1 beat = 500 ms at 120 bpm, 4\/4/.test(beatNote), beatNote);
  await page.getByRole('button', { name: 'Reset' }).click();
  await page.getByRole('button', { name: 's', exact: true }).click();
  await page.getByRole('button', { name: 'Sync' }).click();

  // ── metronome: the tab's beats, through its tempo change ─────────────────
  await page.evaluate(() => {
    const a = document.querySelector('audio');
    a.currentTime = 44; // bar 23, 2 s before the Chorus drops to 60 bpm
  });
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Metronome/ }).click();
  const status = await page.getByTestId('tab-metronome-status').innerText().catch(() => '');
  check('the metronome follows the tab and names its tempo changes', /Follows the tab: 120 bpm here \(tempo changes 120 → 60\)/.test(status), status);
  await page.waitForTimeout(7500);
  const clicks = await page.evaluate(() => window.__clicks);
  const gaps = clicks.slice(1).map((c, i) => Math.round((c.t - clicks[i].t) * 100) / 100);
  const fast = gaps.filter((g) => Math.abs(g - 0.5) < 0.06).length;
  const slow = gaps.filter((g) => Math.abs(g - 1) < 0.06).length;
  check('it clicks every half second at 120 bpm, then every second at 60', fast >= 2 && slow >= 2, JSON.stringify(gaps));
  const accents = clicks.filter((c) => c.f > 1500).length;
  check('with the first beat of each bar accented', accents >= 1 && accents < clicks.length, `${accents} of ${clicks.length}`);
  await page.getByRole('button', { name: /Metronome/ }).click();

  // ── speed: 50%, pitch kept ────────────────────────────────────────────────
  await page.getByRole('button', { name: /Practice/ }).click();
  await page.getByRole('button', { name: '50%' }).click();
  const el = await page.evaluate(() => {
    const a = document.querySelector('audio');
    return { rate: a.playbackRate, pitch: a.preservesPitch };
  });
  check('50% slows the recording down with its pitch kept', el.rate === 0.5 && el.pitch === true, JSON.stringify(el));
  const t0 = await now(page);
  await page.waitForTimeout(2000);
  const t1 = await now(page);
  check('the song runs at half speed', t1 - t0 > 0.7 && t1 - t0 < 1.3, `${(t1 - t0).toFixed(2)} s of song in 2 s`);
  const bpmField = await page.getByLabel('Speed in bpm').inputValue();
  check('and says the tempo heard', bpmField === '30' || bpmField === '60', `${bpmField} bpm`);
  await page.getByRole('button', { name: '100%' }).click();
  check('back to 100%', (await page.evaluate(() => document.querySelector('audio').playbackRate)) === 1);

  // ── loop: bars typed in, marked, and looped ───────────────────────────────
  await page.getByLabel('Loop from bar').fill('3');
  await page.getByLabel('Loop to bar').fill('3');
  await page.waitForTimeout(600);
  const start = await now(page);
  check('turning the loop on outside it goes to its start (bar 3 is at 4 s)', start >= 3.9 && start < 5, start.toFixed(2));
  const marked = await page.locator('.at-selection div').count();
  check('the loop is marked on the score', marked > 0, `${marked} blocks`);
  const seen = [];
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(250);
    seen.push(await now(page));
  }
  const inside = seen.every((s) => s >= 3.9 && s <= 6.15);
  const wrapped = seen.some((s, i) => i > 0 && s < seen[i - 1]);
  check('it plays bar 3 over and over (4 s to 6 s)', inside && wrapped, seen.map((s) => s.toFixed(1)).join(' '));
  const chip = await page.getByRole('button', { name: /Practice/ }).innerText();
  check('the chip says what loops', /Bar 3/.test(chip), chip.replace(/\s+/g, ' '));
  await page.getByLabel('Loop a section').selectOption({ label: 'Verse (bars 9–24)' });
  await page.waitForTimeout(600);
  const verse = await now(page);
  check('a section loops from its marker (the Verse at bar 9, 16 s)', verse >= 15.9 && verse < 17.5, verse.toFixed(2));
  await page.getByRole('button', { name: 'Clear' }).click();
  check('Clear takes the mark away', (await page.locator('.at-selection div').count()) === 0);

  // Picking on the tab: two clicks.
  await page.getByRole('button', { name: 'Pick on the tab' }).click();
  const hint = await page.getByTestId('tab-loop-picking').innerText().catch(() => '');
  check('Pick on the tab asks for the first bar', /first bar/.test(hint), hint);
  await page.getByRole('button', { name: 'Cancel picking' }).click();
  await page.close();
}

// ── Find one: a song with no tab ───────────────────────────────────────────
{
  const page = await newPage({ width: 1300, height: 950 });
  await page.context().route(/ultimate-guitar\.com|duckduckgo\.com|songsterr\.com/, (r) => r.fulfill({ status: 200, body: 'ok' }));
  await page.goto(`${APP_URL}${trackPath(bare.id)}`, { waitUntil: 'networkidle' });
  await page.locator('[data-testid="tabs-empty"]:not([data-state="searching"])').waitFor({ timeout: 20_000 }).catch(() => {});
  // The places to look by hand: rows when Songsterr has nothing, the line
  // under Songsterr's versions when it has some.
  const place = (id) => page.locator(`[data-testid="tabs-empty-site"][data-link="${id}"], [data-testid="tab-search-links"] a[data-link="${id}"]`).first();
  for (const [id, name, host] of [['ultimate-guitar', 'Ultimate Guitar', 'www.ultimate-guitar.com'], ['guitar-pro', 'Guitar Pro files', 'duckduckgo.com']]) {
    const popup = page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null);
    await place(id).click();
    const opened = await popup;
    const url = opened ? opened.url() : '';
    check(`Find one: ${name} opens its search for the song`, url.includes(host) && /Practice(\+|%20)Tester/.test(url), url);
    await opened?.close();
  }
  // Songsterr: a version of the song opens its page there.
  const versions = page.getByTestId('tabs-empty-match');
  if (await versions.count()) {
    const popup = page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null);
    await versions.first().click();
    const opened = await popup;
    const url = opened ? opened.url() : '';
    check('Find one: a Songsterr version opens its page', url.includes('www.songsterr.com') && /practice-bare/i.test(url), url);
    await opened?.close();
  }
  await page.close();
}

check('no unexpected console errors', consoleErrors.filter((e) => !/favicon|Failed to load resource/.test(e)).length === 0, consoleErrors.slice(0, 5).join(' | '));
await browser.close();
const failed = checks.filter(([, p]) => !p).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
