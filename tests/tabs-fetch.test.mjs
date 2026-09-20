/** Tabs found online (docs/tabs-v3.md stages 3 to 5) in a real sandbox,
 *  against tests/fake-songsterr.mjs (which also serves the fake Ultimate
 *  Guitar under /ug):
 *
 *   - Ultimate Guitar: opening the tab page of a song with no tab makes the
 *     server search once and fetch the best guitar and bass tab; the guitar
 *     tab is drawn with its "From Ultimate Guitar" chip and follows the song
 *     (cursor bar against the real audio time, tests/tabs-measure.mjs); the
 *     picker lists both; opening it again (a fresh page, another member)
 *     asks the site nothing; "Search online again" searches once more and
 *     fetches nothing it already has.
 *   - Songsterr: a song it has is fetched as one multi-track tab with real
 *     rhythm, lined up with the recording by align.py in the background
 *     (the chip goes from "not lined up yet" to "lined up"), and the cursor
 *     then sits on the right beat within 50 ms, at several points of a
 *     recording played 3% slower than the tab, after seeks.
 *
 *      node tests/fake-songsterr.mjs 4330 &
 *      node tests/tabs-fetch.test.mjs        # or: npm run test:tabs-fetch
 *
 *  Needs a sandbox: PocketBase (PB_URL) restarted with this branch's
 *  pb_hooks (the "fetched" kind, tab_lookups, timing), the app (APP_URL)
 *  built from this tree and started with SONGSTERR_BASE, SONGSTERR_CDN_BASE
 *  and UG_BASE pointing at the fake (FAKE_SS, FAKE_UG), PYTHON_BIN at the
 *  venv (align.py runs for real), and MUSIC_DIR set to the app's MUSIC_DIR
 *  for the on-disk checks (skipped without it). Songs are uploaded wavs, so
 *  no network. Set CHROME_PATH to pick a browser. */
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
import { timeline } from './fixtures/songsterr/build.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('This test needs playwright-core:\n\n  npm i -D playwright-core\n');
  process.exit(2);
}

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8095';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3030';
const FAKE_SS = process.env.FAKE_SS ?? 'http://127.0.0.1:4330';
const FAKE_UG = process.env.FAKE_UG ?? `${FAKE_SS}/ug`;
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
const ssCalls = () => fetch(`${FAKE_SS}/__calls`).then((r) => r.json());
try {
  await calls();
  await ssCalls();
} catch {
  console.error(`The fake tab sites are not answering at ${FAKE_SS}: node tests/fake-songsterr.mjs 4330`);
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
  return wavOf(data, sampleRate);
}

/** 16-bit mono PCM with a wav header around it. */
function wavOf(data, sampleRate) {
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
async function uploadSong(title, artist, bytes = makeWav()) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }), 'song.wav');
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

// ── the Songsterr fixture played as a recording ───────────────────────────
// The tab (tests/fixtures/songsterr/build.mjs) with every note plucked and
// clicked where it sounds, 3% slower than written and 1.35 s in.
const LINE = timeline();
const SS_OFFSET = 1.35;
const SS_SCALE = 1.03;
const songSec = (tabSec) => SS_OFFSET + tabSec * SS_SCALE;

function riffWav(sampleRate = 22050) {
  const samples = Math.ceil((songSec(LINE.end) + 2) * sampleRate);
  const buf = new Float32Array(samples);
  const pluck = (at, midi) => {
    const i = Math.round(at * sampleRate);
    const freq = 440 * 2 ** ((midi - 69) / 12);
    const n = Math.min(Math.round(0.6 * sampleRate), samples - i);
    for (let k = 0; k < n; k++) {
      const t = k / sampleRate;
      const env = Math.exp(-t / 0.25) * Math.min(1, t / 0.003);
      buf[i + k] += 0.2 * env * (Math.sin(2 * Math.PI * freq * t) + 0.5 * Math.sin(4 * Math.PI * freq * t));
    }
  };
  const click = (at) => {
    const i = Math.round(at * sampleRate);
    const n = Math.min(Math.round(0.02 * sampleRate), samples - i);
    let seed = i;
    for (let k = 0; k < n; k++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      buf[i + k] += 0.35 * ((seed / 0x3fffffff) - 1) * Math.exp(-(k / sampleRate) / 0.004);
    }
  };
  for (const { sec, pitches } of LINE.onsets) {
    const at = songSec(sec);
    if (at < 0 || at * sampleRate >= samples) continue;
    click(at);
    for (const p of pitches) pluck(at, p);
  }
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round((buf[i] / (peak || 1)) * 26000), i * 2);
  return wavOf(data, sampleRate);
}

/** Seek the recording itself, precisely (the player bar is a few pixels a
 *  second): the app reads the element's time and moves the line from it. */
const seekAudio = (page, sec) =>
  page.evaluate((t) => {
    const a = window.__audios?.[window.__audios.length - 1];
    if (a) a.currentTime = t;
  }, sec);

/** Every chord of the drawn track: the fret numbers of one beat sit above
 *  each other, rows are the systems AlphaTab wraps the bars into. `c` is
 *  where the beat sounds on the page (the numbers' middle), which is where
 *  the cursor stands when it plays. */
const beatBoxes = (page) =>
  page.evaluate(() => {
    const digits = [...document.querySelectorAll('[data-testid="tab-score"] text')]
      .filter((t) => /^\d+$/.test(t.textContent?.trim() ?? '') && !/^rgba\(156,\s*158,\s*162/.test(t.getAttribute('fill') || ''))
      .map((t) => {
        const r = t.getBoundingClientRect();
        return { c: r.x + r.width / 2, y: r.y };
      })
      .sort((a, b) => a.y - b.y);
    const rows = [];
    for (const t of digits) {
      const row = rows[rows.length - 1];
      if (row && t.y - row[row.length - 1].y < 80) row.push(t);
      else rows.push([t]);
    }
    const out = [];
    for (const row of rows) {
      const top = Math.min(...row.map((p) => p.y));
      const cols = [];
      for (const t of [...row].sort((a, b) => a.c - b.c)) {
        const col = cols[cols.length - 1];
        if (col && t.c - col.cs[0] < 15) col.cs.push(t.c);
        else cols.push({ cs: [t.c], y: top });
      }
      out.push(...cols.filter((col) => col.cs.length >= 2).map((col) => ({ c: col.cs[Math.floor(col.cs.length / 2)], y: col.y, n: col.cs.length })));
    }
    return out;
  });

const song = await uploadSong(`Ugfetch Song ${run}`, 'UGTester');
const missing = await uploadSong(`Nothing Online ${run}`, 'UGTester');
const ssSong = await uploadSong(`Ssfetch Song ${run}`, 'SSTester', riffWav());
// A song both fakes have: Songsterr's tab is the recording, Ultimate
// Guitar's is another song's riff, so stage 7 has a real choice to make.
const bothSong = await uploadSong(`Ssfetch Ugfetch Both ${run}`, 'BothTester', riffWav());
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

// ── the Source sheet (docs/tabs-v3.md stage 6) ────────────────────────────
/** Open the sheet from the source chip and wait for its first row. */
async function openSheet(page) {
  await page.getByRole('button', { name: 'Choose a tab' }).click();
  await page.getByTestId('tab-source-row').first().waitFor({ timeout: 10_000 }).catch(() => {});
}
/** Every row of the sheet as one line, in the order it lists them. */
const sheetRows = (page) =>
  page.getByTestId('tab-source-row').evaluateAll((els) => els.map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()));
/** Choose the nth source; the sheet closes and the tab is drawn. */
const pickRow = (page, n) => page.getByTestId('tab-source-row').nth(n).getByRole('radio').click();

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

  await openSheet(page);
  const items = await sheetRows(page);
  check('the sheet lists the guitar tab and the bass tab with their ratings',
    items.length === 2 && /Text tab/.test(items[0]) && /★ 4\.7 \(512 votes\)/.test(items[0]) &&
    /Bass tab/.test(items[1]) && /★ 4\.6 \(140 votes\)/.test(items[1]),
    items.join(' | '));
  check('under one Ultimate Guitar heading', (await page.getByTestId('tab-source-sheet').getByText('Ultimate Guitar', { exact: true }).count()) === 1);
  await pickRow(page, 1);
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
  // Both sites are remembered: Songsterr has nothing for this one.
  const bySite = Object.fromEntries(lk.map((x) => [x.site, x.status]));
  check('both sites are recorded as searched', lk.length === 2 && bySite.ug === 'found' && bySite.songsterr === 'none', JSON.stringify(bySite));
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

// ── Songsterr: rhythm, every instrument, lined up with the recording ──────
// The recording is the fixture tab played 3% slower than it is written,
// starting 1.35 s in (tests/fixtures/songsterr/build.mjs timeline()), so
// nothing lines up by accident: align.py has to find it.
console.log('\n=== Songsterr, with rhythm and lined up ===\n');
{
  await fetch(`${FAKE_SS}/__reset`, { method: 'POST' });
  const page = await newPage(listener);
  await page.goto(`${APP_URL}/library/uploads`, { waitUntil: 'networkidle' });
  await page.getByText(ssSong.title, { exact: true }).first().click({ clickCount: 2 });
  await page.waitForTimeout(1500);
  await page.locator('footer').getByRole('button', { name: 'Guitar tabs' }).first().click();
  await page.waitForURL((u) => u.pathname === trackPath(ssSong.id), { timeout: 10_000, waitUntil: 'commit' }).catch(() => {});
  await scoreReady(page).catch(() => {});
  await page.waitForTimeout(1000);

  const c = await ssCalls();
  // Two searches: the link-out list the page shows, and the one that
  // fetches. Then the song page and one part per drawn instrument.
  check('two searches, one song page, three parts (two guitars and the bass)',
    c.patterns.length === 2 && c.pages.length === 1 && c.parts.map((p) => p.part).join(',') === '2,1,3',
    `${c.patterns.length} searches, ${c.pages.length} pages, parts ${c.parts.map((p) => p.part).join(',')}`);

  const chip = await chipText(page);
  check('the chip says Songsterr and names the instrument drawn', /^From Songsterr, Rhythm Guitar, /.test(chip), chip);
  const tracks = await page.getByRole('group', { name: 'Tracks' }).getByRole('button').allInnerTexts();
  check('all three instruments are in the picker, the rhythm guitar first',
    tracks.length === 3 && /Rhythm Guitar/.test(tracks[0]) && /Lead Guitar/.test(tracks[1]) && /Bass/.test(tracks[2]), tracks.join(' | '));
  const header = await page.getByTestId('tab-sheet-header').innerText().catch(() => '');
  check('the header reads the tab’s own 100 bpm and Drop D', /100 bpm/.test(header) && /Drop D/.test(header), header.replace(/\s+/g, ' '));

  // The job started when the tab was fetched; the chip says so when it is done.
  const lined = await page
    .waitForFunction(() => /lined up/.test(document.querySelector('[data-testid="tab-source-chip"]')?.textContent ?? '') &&
      !/not lined up/.test(document.querySelector('[data-testid="tab-source-chip"]')?.textContent ?? ''), null, { timeout: 180_000 })
    .then(() => true, () => false);
  check('the chip goes from "not lined up yet" to "lined up"', lined, await chipText(page));
  check('and the "Line it up" button is gone', (await page.getByTestId('tab-line-up').count()) === 0);

  const row = await fetch(`${PB_URL}/api/collections/tabs/records?filter=${encodeURIComponent(`track_key = "${ssSong.id}" && source_site = "songsterr"`)}`,
    { headers: { Authorization: token } }).then((r) => r.json()).then((j) => (j.items ?? [])[0]);
  check('the row keeps Songsterr’s song, its parts and the parse report', !!row &&
    row.source_id === '777001' && row.source_meta?.instruments?.join(',') === 'Rhythm Guitar,Lead Guitar,Bass' &&
    row.source_meta?.report?.bars === 18 && row.source_meta?.report?.anacrusis === true,
    JSON.stringify({ id: row?.source_id, instruments: row?.source_meta?.instruments, bars: row?.source_meta?.report?.bars }));
  const timing = row?.timing;
  check('the timing found the recording: bar 1 at 1.35 s, 97 bpm, all 18 bars',
    !!timing && Math.abs(timing.offset_ms - SS_OFFSET * 1000) <= 60 && Math.abs(timing.bpm - 100 / SS_SCALE) <= 1.5 &&
    timing.bars?.length === 18 && timing.confidence >= 0.5,
    JSON.stringify({ offset: timing?.offset_ms, bpm: timing?.bpm, bars: timing?.bars?.length, confidence: timing?.confidence }));
  if (timing?.bars) {
    const worst = Math.max(...timing.bars.map((b) => Math.abs(b.ms / 1000 - songSec(LINE.bars[b.bar].sec))));
    check('every bar anchor is within 50 ms of where the recording plays it', worst <= 0.05, `worst ${(worst * 1000).toFixed(0)} ms`);
  }
  if (MUSIC_DIR && row) {
    const tex = path.join(MUSIC_DIR, 'tabs', 'fetched', row.file);
    check('on disk: the alphaTex and Songsterr’s parts beside it',
      fs.existsSync(tex) && fs.existsSync(tex.replace(/\.alphatex$/, '.json')));
  }

  // ── the cursor on the beat ──────────────────────────────────────────────
  // Every beat of the rhythm guitar is a three-digit chord in the drawing;
  // the cursor covers the beat it is on. Reading them together says which
  // beat the line sits on, with no pixel arithmetic in between.
  await page.locator('footer').getByRole('button', { name: 'Pause', exact: true }).click().catch(() => {});
  await page.waitForTimeout(400);
  const beats = LINE.perPart[2];
  // AlphaTab draws a system when it comes into view: run down the page
  // until every bar exists before the chords are counted.
  let first = [];
  for (let pass = 0; pass < 8; pass++) {
    await page.evaluate(async () => {
      const scroller = document.querySelector('[data-app-scroller]');
      if (!scroller) return;
      for (let y = 0; y <= scroller.scrollHeight; y += 300) {
        scroller.scrollTo({ top: y, behavior: 'instant' });
        await new Promise((r) => setTimeout(r, 150));
      }
    });
    await page.waitForTimeout(600);
    const next = await beatBoxes(page);
    if (next.length === first.length || next.length >= beats.length) {
      first = next;
      break;
    }
    first = next;
  }
  check('the drawing has a chord for every beat of the rhythm guitar', first.length === beats.length, `${first.length} of ${beats.length}`);

  /** The line, the chords and the bar numbers after seeking the recording
   *  to `sec`. Read together, and read again every time: the page scrolls
   *  to the line, and AlphaTab draws a system when it comes into view. */
  const lookAt = async (sec) => {
    await seekAudio(page, sec);
    await page.waitForTimeout(500);
    const [cur, boxes, labels] = await Promise.all([cursorRect(page), beatBoxes(page), barLabels(page)]);
    return { cur, boxes, labels };
  };

  /** Where on the page the `i`th beat of bar `bar` is drawn, on the line's
   *  own system: the line covers the system's whole height, which its bar
   *  numbers and fret numbers sit inside of. */
  const beatX = ({ cur, boxes, labels }, bar, i) => {
    if (!cur) return null;
    const onRow = (y) => y >= cur.y - 12 && y <= cur.y + cur.h + 12;
    const rowLabels = labels.filter((l) => onRow(l.y)).sort((a, b) => a.x - b.x);
    // A system's first bar number is drawn after its clef, so anything
    // left of it still belongs to that bar.
    const barOf = (x) => [...rowLabels].reverse().find((l) => l.x <= x + 15) ?? rowLabels[0] ?? null;
    const inBar = boxes.filter((b) => onRow(b.y) && barOf(b.c)?.n === bar).sort((a, b) => a.c - b.c);
    return inBar[i]?.c ?? null;
  };

  if (first.length === beats.length) {
    // The line moves with the recording, so where it stands says what time
    // it shows: a twentieth of a second before a beat it has not reached
    // that beat's chord, and a twentieth after it has passed it. Beats in
    // the middle of bars spread through the song, after the 3/4 bar and
    // both tempo changes, each read after a seek.
    const probeBars = [3, 6, 9, 13, 15, 17];
    const off = [];
    for (const bar of probeBars) {
      const k = beats.findIndex((b) => b.bar === bar - 1) + 2;
      const i = 2;
      const at = songSec(beats[k].sec);
      const after = await lookAt(at + 0.05);
      const x = beatX(after, bar, i);
      const before = await lookAt(at - 0.05);
      const reached = x !== null && after.cur && after.cur.x >= x - 2;
      const notYet = x !== null && before.cur && before.cur.x < x + 2;
      if (!reached || !notYet) {
        off.push(`bar ${bar} beat ${i + 1} at ${at.toFixed(2)}s: chord at ${x?.toFixed(0)}px, line at ${before.cur?.x?.toFixed(0)}px before and ${after.cur?.x?.toFixed(0)}px after`);
      }
    }
    check(`the line is on the right beat within 50 ms at ${probeBars.length} points`, off.length === 0, off.join(' | '));

    // And the other way: clicking a beat seeks the recording to it.
    const clicks = [];
    for (const bar of [4, 12, 16]) {
      const k = beats.findIndex((b) => b.bar === bar - 1) + 3;
      const want = songSec(beats[k].sec);
      const look = await lookAt(want);
      const x = beatX(look, bar, 3);
      if (x === null) {
        clicks.push(`bar ${bar}: no chord found`);
        continue;
      }
      await page.mouse.click(x, look.cur.y + 20);
      await page.waitForTimeout(500);
      const t = await realTime(page);
      if (t === null || Math.abs(t - want) > 0.1) clicks.push(`bar ${bar}: clicked a beat that sounds at ${want.toFixed(2)}s, song went to ${t?.toFixed(2)}s`);
    }
    check('clicking a beat seeks the recording to where it sounds', clicks.length === 0, clicks.join(' | '));
  }
  await page.context().close();
}

// ── two sites for one song: the best match wins, the pick sticks ─────────
// Both fakes answer for this song. Songsterr's tab IS the recording, so it
// lines up; Ultimate Guitar's is another riff. Ember draws the Songsterr
// one, the sheet says why, and a listener's own pick overrides it for good.
console.log('\n=== Picking between two sites ===\n');
{
  const page = await newPage(listener);
  await page.goto(`${APP_URL}${trackPath(bothSong.id)}`, { waitUntil: 'networkidle' });
  await scoreReady(page).catch(() => {});
  const lined = await page
    .waitForFunction(() => {
      const t = document.querySelector('[data-testid="tab-source-chip"]')?.textContent ?? '';
      return /^From Songsterr/.test(t) && /, lined up/.test(t);
    }, null, { timeout: 240_000 })
    .then(() => true, () => false);
  check('the Songsterr tab is the one drawn, lined up with the recording', lined, await chipText(page));

  await openSheet(page);
  const rows = await sheetRows(page);
  const sheetText = (await page.getByTestId('tab-source-sheet').innerText().catch(() => '')).replace(/\s+/g, ' ');
  check('the sheet lists both sites, Songsterr first with "Best match"',
    rows.length === 3 && /Tab with rhythm/.test(rows[0]) && /Best match/.test(rows[0]) && /Lined up \d+%/.test(rows[0]) &&
    rows.slice(1).every((r) => /Text tab|Bass tab/.test(r) && /(Lined up \d+%|Not lined up yet|Lining it up)/.test(r)),
    rows.join(' | '));
  // The site headings are drawn in small caps, so innerText shouts them.
  check('under both site headings', /songsterr/i.test(sheetText) && /ultimate guitar/i.test(sheetText), sheetText.slice(0, 160));

  await pickRow(page, 1);
  await page.waitForFunction(() => /^From Ultimate Guitar/.test(document.querySelector('[data-testid="tab-source-chip"]')?.textContent ?? ''),
    null, { timeout: 15_000 }).catch(() => {});
  check('choosing the Ultimate Guitar tab draws it', /^From Ultimate Guitar/.test(await chipText(page)), await chipText(page));
  await page.reload({ waitUntil: 'networkidle' });
  await scoreReady(page).catch(() => {});
  await page.waitForTimeout(800);
  check('and that choice sticks across a reload', /^From Ultimate Guitar/.test(await chipText(page)), await chipText(page));

  // "Line it up" on a row runs align.py again for that tab.
  await openSheet(page);
  const first = page.getByTestId('tab-source-row').first();
  await first.getByRole('button', { name: 'Line it up' }).click();
  const busy = await first.getByRole('button', { name: 'Lining it up…' }).waitFor({ timeout: 15_000 }).then(() => true, () => false);
  check('"Line it up" runs the alignment again', busy);
  await page.context().close();
}

// ── the sheet fits every window ──────────────────────────────────────────
for (const width of [390, 1280]) {
  const page = await newPage(listener, { width, height: 900 });
  await page.goto(`${APP_URL}${trackPath(bothSong.id)}`, { waitUntil: 'networkidle' });
  await scoreReady(page).catch(() => {});
  await openSheet(page);
  const boxes = await page.$$eval(
    '[data-testid="tab-source-sheet"], [data-testid="tab-source-row"], [data-testid="tab-source-sheet"] button',
    (els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      return { text: (el.textContent ?? '').trim().slice(0, 30), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) };
    }),
  );
  const outside = boxes.filter((b) => b.w > 0 && (b.right > width + 1 || b.left < -1));
  const scroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  check(`${width}: the source sheet and every row end inside the window`, boxes.length >= 6 && outside.length === 0,
    `${boxes.length} boxes ${JSON.stringify(outside).slice(0, 160)}`);
  check(`${width}: the sheet adds no sideways page scroll`, scroll.sw <= scroll.iw, `page ${scroll.sw}px in a ${scroll.iw}px window`);
  await page.context().close();
}

const noisy = consoleErrors.filter((e) => !/favicon|404/.test(e));
check('no unexpected console errors', noisy.length === 0, noisy.slice(0, 2).join(' | '));

await browser.close();
const failed = checks.filter(([, p]) => !p);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map(([n]) => n).join(', '));
process.exit(failed.length ? 1 : 0);
