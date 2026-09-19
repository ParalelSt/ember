/** Tabs found online (docs/tabs-v3.md stage 3) in a real sandbox, against
 *  tests/fake-ug.mjs: opening the tab page of a song with no tab makes the
 *  server search Ultimate Guitar once and fetch the best guitar and bass
 *  tab; the guitar tab is drawn with its "From Ultimate Guitar" chip and
 *  follows the song (cursor bar against the real audio time,
 *  tests/tabs-measure.mjs); the picker lists both; opening it again (a fresh
 *  page, another member) asks the site nothing; "Search online again"
 *  searches once more and fetches nothing it already has.
 *
 *      node tests/fake-ug.mjs 4331 &
 *      node tests/tabs-fetch.test.mjs        # or: npm run test:tabs-fetch
 *
 *  Needs a sandbox: PocketBase (PB_URL) restarted with this branch's
 *  pb_hooks (the "fetched" kind, tab_lookups), the app (APP_URL) built from
 *  this tree and started with UG_BASE=http://127.0.0.1:4331 (FAKE_UG), and
 *  MUSIC_DIR set to the app's MUSIC_DIR for the on-disk checks (skipped
 *  without it). Songs are uploaded wavs, so no network. Set CHROME_PATH to
 *  pick a browser. */
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
const FAKE_UG = process.env.FAKE_UG ?? 'http://127.0.0.1:4331';
const MUSIC_DIR = process.env.MUSIC_DIR ?? null;
const PASSWORD = 'BugTest2026!';

// The fixture tab (tests/fixtures/ug/tab-9100001.html): "Tempo: 100", 4/4,
// so a bar is 2.4 s; four bars played ten times make 40 bars, 96 s.
const BAR_SEC = 2.4;
const TOLERANCE_SEC = 0.6 + 0.2; // one beat plus slack for pixels and rounding

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

const calls = () => fetch(`${FAKE_UG}/__calls`).then((r) => r.json());
try {
  await calls();
} catch {
  console.error(`The fake Ultimate Guitar is not answering at ${FAKE_UG}: node tests/fake-ug.mjs 4331`);
  process.exit(2);
}

const token = await adminToken();
const run = `${process.pid}-${Math.floor(Math.random() * 1e6)}`;

async function member(tag, name) {
  const email = `tabsfetch-${tag}-${run}@ember.test`;
  await fetch(`${PB_URL}/api/collections/users/records`, { method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: token },
    body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name, verified: true }) });
  const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PASSWORD }) })
    .then((r) => r.json());
  return encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));
}
const listener = await member('listener', 'Fetch Listener');
const other = await member('other', 'Fetch Other');

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

/** The fake finds songs whose query holds "ugfetch": artist one word, the
 *  rest the title (tests/fake-ug.mjs). */
async function uploadSong(title, artist) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(makeWav())], { type: 'audio/wav' }), 'song.wav');
  form.append('title', title);
  form.append('artist', artist);
  const res = await fetch(`${APP_URL}/api/uploads`, { method: 'POST', body: form, headers: { cookie: `pb_auth=${listener}` } });
  if (!res.ok) throw new Error(`could not seed a song: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).track;
}

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const song = await uploadSong(`Ugfetch Song ${run}`, 'UGTester');
const missing = await uploadSong(`Nothing Online ${run}`, 'UGTester');
await fetch(`${FAKE_UG}/__reset`, { method: 'POST' });

const consoleErrors = [];
const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });

async function newPage(cookie, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([{ name: 'pb_auth', value: cookie, domain: new URL(APP_URL).hostname, path: '/' }]);
  await installAudioProbe(ctx);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  return page;
}
const scoreReady = (page) =>
  page.waitForFunction(() => document.querySelector('[data-testid="tab-score"]')?.dataset.status === 'ready', null, { timeout: 45_000 });
const trackPath = (id) => `/tabs/${encodeURIComponent(id)}`;
const chipText = async (page) => ((await page.getByTestId('tab-source-chip').textContent().catch(() => '')) ?? '').trim();

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

// ── first opening: the search runs, the tab is drawn and follows ───────────
console.log('\n=== First opening ===\n');
{
  const page = await newPage(listener);
  await page.goto(`${APP_URL}/library/uploads`, { waitUntil: 'networkidle' });
  await page.getByText(song.title, { exact: true }).first().click({ clickCount: 2 });
  await page.waitForTimeout(1500);
  await page.locator('footer').getByRole('button', { name: 'Guitar tabs' }).first().click();
  await page.waitForURL((u) => u.pathname === trackPath(song.id), { timeout: 10_000, waitUntil: 'commit' }).catch(() => {});
  const searching = await page.getByTestId('tabs-searching').waitFor({ timeout: 5000 }).then(() => true, () => false);
  check('the page says it is finding a tab online', searching);
  await scoreReady(page).catch(() => {});
  await page.waitForTimeout(1200);

  const c = await calls();
  check('one search and two tab pages (guitar, bass)', c.searches.length === 1 && c.pages.length === 2,
    `${c.searches.length} searches, pages ${c.pages.map((p) => p.id).join(',')}`);
  check('it searched "artist title" for tabs and bass tabs', c.searches[0]?.q === `UGTester ${song.title}` &&
    JSON.stringify(c.searches[0]?.types) === '["200","400"]', JSON.stringify(c.searches[0]));
  check('with a browser User-Agent', /Mozilla\/5\.0/.test(c.searches[0]?.ua ?? ''), c.searches[0]?.ua);
  check('it fetched the best whole-song tab and the bass tab', JSON.stringify(c.pages.map((p) => p.id)) === '[9100001,9100011]');

  const surface = await page.evaluate(() => {
    const r = document.querySelector('[data-testid="tab-score"] .at-surface')?.getBoundingClientRect();
    return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null;
  });
  check('AlphaTab draws the fetched tab', !!surface && surface.w > 300 && surface.h > 100, JSON.stringify(surface));
  const chip = await chipText(page);
  check('the chip says Ultimate Guitar and not lined up yet', chip === 'From Ultimate Guitar, not lined up yet', chip);
  const header = await page.getByTestId('tab-sheet-header').innerText().catch(() => '');
  check('the header reads 100 bpm and Drop D from the tab', /100 bpm/.test(header) && /Drop D/.test(header), header.replace(/\s+/g, ' '));

  const a = await measure(page);
  check('playing: the line is at the song’s time', !!a && a.diff <= TOLERANCE_SEC, a ? `line ${a.lineSec.toFixed(2)}s, audio ${a.t.toFixed(2)}s` : 'no reading');
  await page.waitForTimeout(4000);
  const b = await measure(page);
  check('four seconds on, still at the song’s time', !!b && b.diff <= TOLERANCE_SEC && b.t > (a?.t ?? 0) + 3,
    b ? `line ${b.lineSec.toFixed(2)}s, audio ${b.t.toFixed(2)}s` : 'no reading');
  const band = await viewBand(page);
  const cur = await cursorRect(page);
  check('the line stays in view below the toolbar', !!cur && cur.top >= band.top - 2 && cur.bottom <= band.bottom + 2);

  await page.getByRole('button', { name: 'Choose a tab' }).click();
  await page.getByRole('menuitem').first().waitFor({ timeout: 5000 }).catch(() => {});
  const items = await page.getByRole('menuitem').allInnerTexts();
  check('the picker lists the guitar tab and the bass tab with their ratings',
    items.length === 2 && items[0] === 'Ultimate Guitar, Text tab, ★ 4.7 (512 votes)' && items[1] === 'Ultimate Guitar, Bass tab, ★ 4.6 (140 votes)',
    items.join(' | '));
  await page.getByRole('menuitem', { name: /Bass tab/ }).click();
  await page.waitForFunction(() => /bass/.test(document.querySelector('[data-testid="tab-source-chip"]')?.textContent ?? ''), null, { timeout: 10_000 }).catch(() => {});
  check('picking the bass tab draws it', /From Ultimate Guitar, bass, not lined up yet/.test(await chipText(page)), await chipText(page));
  await page.context().close();
}

// ── in the store ───────────────────────────────────────────────────────────
{
  const filter = encodeURIComponent(`track_key = "${song.id}" && kind = "fetched"`);
  const rows = await fetch(`${PB_URL}/api/collections/tabs/records?filter=${filter}&sort=created`, { headers: { Authorization: token } })
    .then((r) => r.json()).then((j) => j.items ?? []);
  const g = rows.find((r) => r.source_id === '9100001');
  check('two shared fetched rows with their source', rows.length === 2 && rows.every((r) => r.shared === true && r.format === 'alphatex' && !r.user && r.source_site === 'ug'),
    rows.map((r) => `${r.kind}/${r.source_id}`).join(','));
  check('the guitar row keeps the page, UG id, rating, votes and tuning', !!g &&
    g.source_url === 'https://tabs.ultimate-guitar.com/tab/the-lantern-keepers/harbour-lights-tabs-9100001' &&
    g.source_rating === 4.71 && g.source_votes === 512 && g.source_meta?.tuning?.value === 'D A D G B E', JSON.stringify(g?.source_meta?.tuning));
  const lk = await fetch(`${PB_URL}/api/collections/tab_lookups/records?filter=${encodeURIComponent(`song_key ~ "ugfetch song ${run.replace('-', ' ')}"`)}`, { headers: { Authorization: token } })
    .then((r) => r.json()).then((j) => j.items ?? []);
  check('the song is recorded as searched', lk.length === 1 && lk[0].status === 'found' && lk[0].site === 'ug', JSON.stringify(lk.map((x) => x.status)));
  if (MUSIC_DIR && g) {
    const tex = path.join(MUSIC_DIR, 'tabs', 'fetched', g.file);
    check('on disk: the alphaTex and the tab text side by side', fs.existsSync(tex) && fs.existsSync(tex.replace(/\.alphatex$/, '.txt')));
  } else console.log('SKIP  on-disk checks (set MUSIC_DIR)');
}

// ── opening again: nothing is asked ────────────────────────────────────────
console.log('\n=== Opening again ===\n');
{
  const before = (await calls()).count;
  for (const cookie of [listener, other]) {
    const page = await newPage(cookie);
    await page.goto(`${APP_URL}${trackPath(song.id)}`, { waitUntil: 'networkidle' });
    await scoreReady(page).catch(() => {});
    await page.waitForTimeout(1000);
    if (cookie === other) check('another member sees the fetched tab', /From Ultimate Guitar/.test(await chipText(page)), await chipText(page));
    await page.context().close();
  }
  check('reopening (the same and another member) asks the site nothing', (await calls()).count === before, `${(await calls()).count - before} new requests`);
}

// ── Search online again ────────────────────────────────────────────────────
{
  const page = await newPage(listener);
  await page.goto(`${APP_URL}${trackPath(song.id)}`, { waitUntil: 'networkidle' });
  await scoreReady(page).catch(() => {});
  const before = await calls();
  await page.getByRole('button', { name: 'Tab options' }).click();
  await page.getByRole('menuitem', { name: 'Search online again' }).click();
  const status = await page.getByTestId('tabs-online-status').waitFor({ timeout: 15_000 }).then(() => page.getByTestId('tabs-online-status').innerText(), () => '');
  const after = await calls();
  check('"Search online again" searches once more and fetches nothing it has',
    after.searches.length === before.searches.length + 1 && after.pages.length === before.pages.length, `${after.count - before.count} new requests`);
  check('and says nothing new was found', status === 'Nothing new found online.', status);
  await page.context().close();
}

// ── a song UG does not have: the empty state, searched once ───────────────
{
  const page = await newPage(listener);
  await page.goto(`${APP_URL}${trackPath(missing.id)}`, { waitUntil: 'networkidle' });
  const empty = await page.getByTestId('tabs-empty').waitFor({ timeout: 15_000 }).then(() => true, () => false);
  check('nothing online: the page falls back to its empty state', empty);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByTestId('tabs-empty').waitFor({ timeout: 15_000 }).catch(() => {});
  const c = await calls();
  check('and that song was searched once only', c.searches.filter((s) => s.q.includes(`Nothing Online ${run}`)).length === 1);
  await page.context().close();
}

const noisy = consoleErrors.filter((e) => !/favicon|404/.test(e));
check('no unexpected console errors', noisy.length === 0, noisy.slice(0, 2).join(' | '));

await browser.close();
const failed = checks.filter(([, p]) => !p);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map(([n]) => n).join(', '));
process.exit(failed.length ? 1 : 0);
