/** Pasted text tabs (docs/tab-sources.md stages 1 to 3) in a real sandbox:
 *  POST /api/tabs/text stores the alphaTex and the original text side by
 *  side, the chain lists it after files, sharing and delete follow the file
 *  rules, and in the browser the tab page draws it with the "Text tab
 *  pasted by" chip and follows the song (cursor bar against the real audio
 *  time, measured with tests/tabs-measure.mjs). Also: the search links of
 *  the empty state and the tab menu carry the right URLs (never clicked).
 *
 *      node tests/tabs-text.test.mjs        # or: npm run test:tabs-text
 *
 *  Needs a sandbox: PocketBase (PB_URL) restarted with this branch's
 *  pb_hooks (the "pasted" kind), the app (APP_URL) built from this tree,
 *  and MUSIC_DIR set to the app's MUSIC_DIR for the on-disk checks (they
 *  are skipped without it). Songs are uploaded wavs, so no network. Set
 *  CHROME_PATH to pick a browser. */
import fs from 'node:fs';
import path from 'node:path';
import {
  barLabels,
  barPositionFromCursor,
  cursorRect,
  installAudioProbe,
  realTime,
  viewBand,
} from './tabs-measure.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('This test needs playwright-core:\n\n  npm i -D playwright-core\n');
  process.exit(2);
}

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8095';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3030';
const MUSIC_DIR = process.env.MUSIC_DIR ?? null;
const PASSWORD = 'BugTest2026!';

// The pasted tab: 120 bpm from its Tempo line, 4/4, so a bar is 2 s; four
// bars played ten times ("x10") make 40 bars, 80 s.
const BAR_SEC = 2;
const TOLERANCE_SEC = 0.5 + 0.2; // one beat plus slack for pixels and rounding
const TEXT = `Pasted riff (an original, for the sandbox)
Tempo 120

e|-----------------|-----------------|-----------------|-----------------|
B|-----------------|-----------------|-----------------|-----------------|
G|-----------------|-----------------|---------2---4---|-----------------|
D|-0---2---3---5---|-0-0-0-0-2---3---|-0---2-----------|-7---5---3---2---|
A|-----------------|-----------------|-----------------|-----------------|
D|-0---------------|-0---------------|-0---------------|-0---------------|
x10
`;

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = path.join(process.env.HOME ?? '', 'Library/Caches/ms-playwright');
  if (!fs.existsSync(root)) throw new Error('no Playwright browser cache, set CHROME_PATH');
  for (const d of fs.readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    for (const rel of [
      'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
      'chrome-linux/chrome',
    ]) {
      const full = path.join(root, d, rel);
      if (fs.existsSync(full)) return full;
    }
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

/** A member with a name (the chip shows it), signed in: the cookie. */
async function member(tag, name) {
  const email = `tabstext-${tag}-${run}@ember.test`;
  await fetch(`${PB_URL}/api/collections/users/records`, { method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: token },
    body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name, verified: true }) });
  const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PASSWORD }) })
    .then((r) => r.json());
  return encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));
}
const listener = await member('listener', 'Text Listener');
const paster = await member('paster', 'Tab Paster');

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

async function uploadSong(title) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(makeWav())], { type: 'audio/wav' }), 'song.wav');
  form.append('title', title);
  form.append('artist', 'Text Tester');
  const res = await fetch(`${APP_URL}/api/uploads`, { method: 'POST', body: form, headers: { cookie: `pb_auth=${listener}` } });
  if (!res.ok) throw new Error(`could not seed a song: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).track;
}

const pasteTab = (cookie, body) =>
  fetch(`${APP_URL}/api/tabs/text`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie: `pb_auth=${cookie}` } : {}) },
    body: JSON.stringify(body),
    // Signed out, the app's proxy answers with a redirect to /auth.
    redirect: 'manual',
  });

async function makeGp() {
  const at = await import(path.join(process.cwd(), 'node_modules/@coderline/alphatab/dist/alphaTab.mjs'));
  const tex = '\\title "File"\n\\tempo 100\n\\tuning (E4 B3 G3 D3 A2 E2)\n0.6.4 2.6.4 3.6.4 5.6.4 |\n0.5.1\n';
  const settings = new at.Settings();
  const imp = new at.importer.AlphaTexImporter();
  imp.initFromString(tex, settings);
  return Buffer.from(new at.exporter.Gp7Exporter().export(imp.readScore(), settings));
}

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const song = await uploadSong(`Pasted Tab Song ${run}`);
const chain = await uploadSong(`Pasted Chain Song ${run}`);
const bare = await uploadSong(`Pasted Bare Song ${run}`);

// ── the route ──────────────────────────────────────────────────────────────
console.log('\n=== POST /api/tabs/text ===\n');
let pasted;
{
  const res = await pasteTab(paster, { text: TEXT, title: song.title, artist: song.artist, trackId: song.id, tuning: 'E4 B3 G3 D3 A2 D2' });
  const body = await res.json();
  pasted = body.tab;
  check('a text tab is stored (201)', res.status === 201, `${res.status}`);
  check('the report reads it: 6 strings, Drop D, 40 bars, 120 bpm from the text',
    body.report?.strings === 6 && body.report?.tuningName === 'Drop D' && body.report?.bars === 40 && body.report?.tempo === 120 && body.report?.tempoSource === 'text',
    JSON.stringify({ s: body.report?.strings, t: body.report?.tuningName, b: body.report?.bars, bpm: body.report?.tempo }));
  check('the row is a shared pasted alphaTex tab', pasted?.kind === 'pasted' && pasted?.format === 'alphatex' && pasted?.shared === true && pasted?.mine === true);

  const rec = await fetch(`${PB_URL}/api/collections/tabs/records/${pasted.id}`, { headers: { Authorization: token } }).then((r) => r.json());
  check('in PocketBase: kind pasted, the file is <stem>.alphatex', rec.kind === 'pasted' && /^[0-9a-f]+\.alphatex$/.test(rec.file), `${rec.kind} ${rec.file}`);
  if (MUSIC_DIR) {
    const tex = path.join(MUSIC_DIR, 'tabs', rec.file);
    const txt = tex.replace(/\.alphatex$/, '.txt');
    check('on disk: the alphaTex and the original text side by side',
      fs.existsSync(tex) && fs.existsSync(txt) && fs.readFileSync(txt, 'utf8') === TEXT);
  } else console.log('SKIP  on-disk checks (set MUSIC_DIR)');

  const dl = await fetch(`${APP_URL}${pasted.downloadUrl}`, { headers: { cookie: `pb_auth=${listener}` } });
  const tex = await dl.text();
  check('another member downloads the alphaTex', dl.status === 200 && tex.includes('\\tuning (E4 B3 G3 D3 A2 D2)') && tex.includes('\\tempo 120'));

  const anon = await pasteTab(null, { text: TEXT });
  check('refused without a user (redirect to sign in or 401)', anon.status === 307 || anon.status === 401, `${anon.status}`);
  const junk = await pasteTab(paster, { text: 'only lyrics here\nC G Am F', title: 'x' });
  check('422 with a report for text that is not a tab', junk.status === 422 && Array.isArray((await junk.json()).report?.skipped));
  const big = await pasteTab(paster, { text: `${TEXT}${'-'.repeat(300 * 1024)}`, title: 'x' });
  check('413 over 256 KB', big.status === 413, `${big.status}`);
  check('400 for a tempo out of range', (await pasteTab(paster, { text: TEXT, tempo: 1000 })).status === 400);
}

// ── the chain: file, then pasted ───────────────────────────────────────────
{
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(await makeGp())]), 'chain.gp');
  form.append('title', chain.title);
  form.append('artist', chain.artist);
  form.append('trackId', chain.id);
  const up = await fetch(`${APP_URL}/api/tabs/files`, { method: 'POST', body: form, headers: { cookie: `pb_auth=${paster}` } });
  // Pasted after the file, so newest first alone would put it on top.
  const p = await pasteTab(paster, { text: TEXT, title: chain.title, artist: chain.artist, trackId: chain.id });
  const q = `trackId=${encodeURIComponent(chain.id)}&title=${encodeURIComponent(chain.title)}&artist=${encodeURIComponent(chain.artist)}`;
  const all = await fetch(`${APP_URL}/api/tabs/files?kind=all&${q}`, { headers: { cookie: `pb_auth=${listener}` } }).then((r) => r.json());
  check('the chain lists the file before the pasted tab', up.status === 201 && p.status === 201 &&
    JSON.stringify(all.tabs?.map((t) => t.kind)) === JSON.stringify(['file', 'pasted']), JSON.stringify(all.tabs?.map((t) => t.kind)));
  const plain = await fetch(`${APP_URL}/api/tabs/files?${q}`, { headers: { cookie: `pb_auth=${listener}` } }).then((r) => r.json());
  check('the default list stays files only', JSON.stringify(plain.tabs?.map((t) => t.kind)) === JSON.stringify(['file']));
}

// ── delete: the paster (or an admin), both files go ────────────────────────
{
  const res = await pasteTab(paster, { text: TEXT, title: `Throwaway ${run}`, artist: 'Nobody' });
  const tab = (await res.json()).tab;
  const rec = await fetch(`${PB_URL}/api/collections/tabs/records/${tab.id}`, { headers: { Authorization: token } }).then((r) => r.json());
  const del = (cookie) => fetch(`${APP_URL}/api/tabs/files/${tab.id}`, { method: 'DELETE', headers: { cookie: `pb_auth=${cookie}` } });
  check('another member cannot delete it (403)', (await del(listener)).status === 403);
  check('whoever pasted it can', (await del(paster)).status === 200);
  if (MUSIC_DIR) {
    const tex = path.join(MUSIC_DIR, 'tabs', rec.file);
    check('both files are gone', !fs.existsSync(tex) && !fs.existsSync(tex.replace(/\.alphatex$/, '.txt')));
  }
}

// ── the browser ────────────────────────────────────────────────────────────
console.log('\n=== The tab page ===\n');
const consoleErrors = [];
const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });

async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([{ name: 'pb_auth', value: listener, domain: new URL(APP_URL).hostname, path: '/' }]);
  await installAudioProbe(ctx);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  return page;
}
const scoreReady = (page) =>
  page.waitForFunction(() => document.querySelector('[data-testid="tab-score"]')?.dataset.status === 'ready', null, { timeout: 30_000 });
const trackPath = (id) => `/tabs/${encodeURIComponent(id)}`;

/** Where the line is, as a song time, against the real audio time. */
async function measure(page) {
  const t = await realTime(page);
  const cursor = await cursorRect(page);
  const labels = await barLabels(page);
  if (t === null || !cursor || labels.length === 0) return null;
  const bar = barPositionFromCursor(labels, cursor);
  if (bar === null) return null;
  const lineSec = (bar - 1) * BAR_SEC;
  return { t, bar, lineSec, diff: Math.abs(lineSec - t) };
}

{
  const page = await newPage({ width: 1440, height: 900 });
  await page.goto(`${APP_URL}/library/uploads`, { waitUntil: 'networkidle' });
  await page.getByText(song.title, { exact: true }).first().click({ clickCount: 2 });
  await page.waitForTimeout(2000);
  await page.locator('footer').getByRole('button', { name: 'Guitar tabs' }).first().click();
  await page.waitForURL((u) => u.pathname === trackPath(song.id), { timeout: 10_000, waitUntil: 'commit' }).catch(() => {});
  check('the player bar opens the pasted song’s tab page', new URL(page.url()).pathname === trackPath(song.id), page.url());
  await scoreReady(page).catch(() => {});
  await page.waitForTimeout(1200);

  const surface = await page.evaluate(() => {
    const r = document.querySelector('[data-testid="tab-score"] .at-surface')?.getBoundingClientRect();
    return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null;
  });
  check('AlphaTab draws the pasted tab', !!surface && surface.w > 300 && surface.h > 100, JSON.stringify(surface));
  const chip = (await page.getByTestId('tab-source-chip').textContent().catch(() => '')) ?? '';
  check('the chip says Text tab pasted by, with the name', /Text tab pasted by Tab Paster, shared/.test(chip), chip);
  const header = await page.getByTestId('tab-sheet-header').innerText().catch(() => '');
  check('the header reads 120 bpm and Drop D from the alphaTex', /120 bpm/.test(header) && /Drop D/.test(header), header.replace(/\s+/g, ' '));

  // Follows the song: the bar under the line matches the real audio time.
  const a = await measure(page);
  check('playing: the line is at the song’s time', !!a && a.diff <= TOLERANCE_SEC, a ? `line ${a.lineSec.toFixed(2)}s, audio ${a.t.toFixed(2)}s` : 'no reading');
  await page.waitForTimeout(4000);
  const b = await measure(page);
  check('four seconds on, still at the song’s time', !!b && b.diff <= TOLERANCE_SEC && b.t > (a?.t ?? 0) + 3,
    b ? `line ${b.lineSec.toFixed(2)}s, audio ${b.t.toFixed(2)}s` : 'no reading');
  const band = await viewBand(page);
  const c = await cursorRect(page);
  check('the line stays in view below the toolbar', !!c && c.top >= band.top - 2 && c.bottom <= band.bottom + 2, c ? `${Math.round(c.top)}..${Math.round(c.bottom)} in ${Math.round(band.top)}..${Math.round(band.bottom)}` : 'no cursor');

  // A seek from the player bar: the line jumps there.
  const track = page.locator('footer [data-slot="slider-track"]');
  // The first wide slider in the player bar is the song (the volume comes later).
  let box = null;
  for (let i = 0; i < (await track.count()) && !box; i++) {
    const bb = await track.nth(i).boundingBox();
    if (bb && bb.width > 20) box = bb;
  }
  if (box) await page.mouse.click(box.x + box.width * (60 / 180), box.y + box.height / 2);
  await page.waitForTimeout(1500);
  const d = await measure(page);
  check('after a seek to 1:00 the line is at the song’s time', !!d && d.t > 55 && d.diff <= TOLERANCE_SEC,
    d ? `line ${d.lineSec.toFixed(2)}s, audio ${d.t.toFixed(2)}s, bar ${d.bar.toFixed(2)}` : 'no reading');

  // The menu carries the three searches (not clicked: they open other sites).
  await page.getByRole('button', { name: 'Tab options' }).click();
  await page.getByRole('menuitem').first().waitFor({ timeout: 5000 }).catch(() => {});
  const items = await page.getByRole('menuitem').allInnerTexts();
  check('the ⋯ menu offers the three searches', ['Search Ultimate Guitar', 'Search Guitar Pro files', 'Open on Songsterr'].every((n) => items.includes(n)), items.join(' | '));
  await page.keyboard.press('Escape');
  await page.context().close();
}

// The chain song: the file first, the pasted tab one pick away.
{
  const page = await newPage({ width: 1440, height: 900 });
  await page.goto(`${APP_URL}${trackPath(chain.id)}`, { waitUntil: 'networkidle' });
  await scoreReady(page).catch(() => {});
  const chip = (await page.getByTestId('tab-source-chip').textContent().catch(() => '')) ?? '';
  check('with a file and a pasted tab, the file shows first', /File added by Tab Paster, shared/.test(chip), chip);
  await page.getByRole('button', { name: 'Choose a tab' }).click();
  await page.getByRole('menuitem').first().waitFor({ timeout: 5000 }).catch(() => {});
  const items = await page.getByRole('menuitem').allInnerTexts();
  check('the picker lists the file, then the text tab', items.length === 2 && /^Guitar Pro file, Tab Paster/.test(items[0]) && /^Text tab, Tab Paster, Guitar/.test(items[1]), items.join(' | '));
  await page.getByRole('menuitem', { name: /^Text tab/ }).click();
  await page.waitForFunction(() => /Text tab pasted by/.test(document.querySelector('[data-testid="tab-source-chip"]')?.textContent ?? ''), null, { timeout: 10_000 }).catch(() => {});
  await scoreReady(page).catch(() => {});
  const after = (await page.getByTestId('tab-source-chip').textContent().catch(() => '')) ?? '';
  const header = await page.getByTestId('tab-sheet-header').innerText().catch(() => '');
  check('picking the text tab draws it', /Text tab pasted by Tab Paster/.test(after) && /120 bpm/.test(header), `${after} / ${header.replace(/\s+/g, ' ')}`);
  await page.context().close();
}

// A song with no tab: the search chips, and generating last and rough.
{
  const page = await newPage({ width: 1440, height: 900 });
  await page.goto(`${APP_URL}${trackPath(bare.id)}`, { waitUntil: 'networkidle' });
  await page.getByTestId('tab-search-links').waitFor({ timeout: 15_000 }).catch(() => {});
  const links = await page.getByTestId('tab-search-links').locator('a').evaluateAll((as) =>
    as.map((a) => ({ text: a.textContent, href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') })),
  ).catch(() => []);
  const q = encodeURIComponent(`${bare.artist} ${bare.title}`).replace(/%20/g, '+');
  const byText = Object.fromEntries(links.map((l) => [l.text, l]));
  check('Ultimate Guitar search link', byText['Ultimate Guitar']?.href === `https://www.ultimate-guitar.com/search.php?search_type=title&value=${q}`, byText['Ultimate Guitar']?.href);
  check('Guitar Pro files search link', byText['Guitar Pro files']?.href === `https://duckduckgo.com/?q=${q}+(gp5+OR+gpx+OR+"guitar+pro")`, byText['Guitar Pro files']?.href);
  check('Songsterr link', /^https:\/\/www\.songsterr\.com\//.test(byText.Songsterr?.href ?? ''), byText.Songsterr?.href);
  check('every search link opens a new tab with noopener', links.length === 3 && links.every((l) => l.target === '_blank' && /noopener/.test(l.rel ?? '')));
  const buttons = await page.getByTestId('tabs-empty').getByRole('button').allInnerTexts();
  check('Add a file comes before Generate a tab (rough)', buttons.indexOf('Add a file') >= 0 && buttons.indexOf('Add a file') < buttons.indexOf('Generate a tab (rough)'), buttons.join(' | '));
  await page.context().close();
}

// The generated-tab status probe answers 404 for "none yet": the API's shape.
const noisy = consoleErrors.filter((e) => !/favicon|404/.test(e));
check('no unexpected console errors', noisy.length === 0, noisy.slice(0, 2).join(' | '));

await browser.close();
const failed = checks.filter(([, p]) => !p);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map(([n]) => n).join(', '));
process.exit(failed.length ? 1 : 0);
