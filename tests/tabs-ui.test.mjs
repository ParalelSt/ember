/** UI check for the tab page (/tabs/[trackId]):
 *  a tab someone else shared, drawn by AlphaTab and synced to Ember's real
 *  playback, opened from the player bar and from Now playing on a phone,
 *  and the empty state (the Songsterr list, the sites, still looking, Add a
 *  file) with no tab generation anywhere.
 *
 *      npm i -D playwright-core
 *      node tests/tabs-ui.test.mjs        # or: npm run test:tabs-ui
 *
 *  Needs a sandbox: PocketBase (PB_URL), the app (APP_URL) built from this
 *  tree with MUSIC_DIR set and SONGSTERR_BASE at tests/fake-songsterr.mjs
 *  (its "zzfail" 503 leaves the app's online Songsterr search backed off for
 *  an hour, so run tabs-fetch.test.mjs against the same app first). Songs
 *  are uploaded wavs, so no yt-dlp and no network. SHOT_DIR=dir saves the
 *  empty states. Set CHROME_PATH to pick a browser. */
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

/** A member with a name (the source chip shows it), signed in: the cookie. */
async function member(tag, name) {
  const email = `tabsui-${tag}-${run}@ember.test`;
  await fetch(`${PB_URL}/api/collections/users/records`, { method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: token },
    body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name, verified: true }) });
  const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PASSWORD }) })
    .then((r) => r.json());
  return encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));
}
const listener = await member('listener', 'Tab Listener');
const sharer = await member('sharer', 'Tab Sharer');

/** A song long enough not to finish mid-test (a track change would move
 *  the page to the next song's tab). */
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
  form.append('artist', 'Tab Tester');
  const res = await fetch(`${APP_URL}/api/uploads`, { method: 'POST', body: form, headers: { cookie: `pb_auth=${listener}` } });
  if (!res.ok) throw new Error(`could not seed a song: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).track;
}

/** A 40-bar, two-track score at 120 bpm (one bar = 2 s), written as a Guitar
 *  Pro 7 file by AlphaTab itself: a real multi-track file with a known
 *  tempo, so "bar 12 starts at 22 s" is something the test can check. */
async function makeGp() {
  const at = await import(path.join(process.cwd(), 'node_modules/@coderline/alphatab/dist/alphaTab.mjs'));
  const bars = (bar) => Array(40).fill(bar).join(' |\n');
  const tex = `\\title "UI Tab"\n\\tempo 120\n\\track ("Guitar" "Gtr")\n\\instrument 30\n\\tuning (E4 B3 G3 D3 A2 D2)\n\\ts (4 4)\n${bars('0.6.8 0.6.8 3.6.8 0.6.8 5.6.8 0.6.8 3.5.8 5.5.8')}\n\\track ("Bass" "Bass")\n\\instrument 33\n\\tuning (G2 D2 A1 D1)\n${bars('0.4.4 3.4.4 5.4.4 3.4.4')}\n`;
  const settings = new at.Settings();
  const imp = new at.importer.AlphaTexImporter();
  imp.initFromString(tex, settings);
  return Buffer.from(new at.exporter.Gp7Exporter().export(imp.readScore(), settings));
}

const song = await uploadSong(`Tab Page Song ${run}`);
const bare = await uploadSong(`Tab Page Bare ${run}`);
{
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(await makeGp())]), 'ui-tab.gp');
  form.append('title', song.title);
  form.append('artist', song.artist);
  form.append('trackId', song.id);
  const res = await fetch(`${APP_URL}/api/tabs/files`, { method: 'POST', body: form, headers: { cookie: `pb_auth=${sharer}` } });
  if (!res.ok) throw new Error(`could not share the tab: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const consoleErrors = [];
const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });

async function newPage(viewport, extra = {}) {
  const ctx = await browser.newContext({ viewport, ...extra });
  await ctx.addCookies([{ name: 'pb_auth', value: listener, domain: new URL(APP_URL).hostname, path: '/' }]);
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
const surface = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-testid="tab-score"] .at-surface');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height) };
});
/** Where the beat cursor is, in page pixels (x and y: rows wrap). */
const cursorAt = (page) => page.evaluate(() => {
  const el = document.querySelector('.at-cursor-beat');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return `${Math.round(r.left + window.scrollX)},${Math.round(r.top)}`;
});
/** The player bar's elapsed time, in seconds. */
const elapsed = (page) => page.evaluate(() => {
  const t = document.querySelector('footer span.tabular-nums')?.textContent ?? '';
  const [m, s] = t.split(':').map(Number);
  return m * 60 + s;
});
const trackPath = (id) => `/tabs/${encodeURIComponent(id)}`;

// ── desktop: the player bar opens the page ─────────────────────────────────
{
  const page = await newPage({ width: 1300, height: 950 });
  await play(page, song.title);
  const tabsButton = page.getByRole('button', { name: 'Guitar tabs' });
  check('the player bar has a Guitar tabs button', (await tabsButton.count()) > 0);
  await tabsButton.first().click();
  await page.waitForURL((u) => u.pathname === trackPath(song.id), { timeout: 10_000, waitUntil: 'commit' }).catch(() => {});
  check('it opens /tabs/<playing track id>', new URL(page.url()).pathname === trackPath(song.id), page.url());
  check('no dialog: the page itself', (await page.getByRole('dialog').count()) === 0);

  await scoreReady(page).catch(() => {});
  await page.waitForTimeout(1500);
  const s = await surface(page);
  check('AlphaTab drew the shared score', Boolean(s && s.w > 300 && s.h > 100), s ? `${s.w}x${s.h}` : 'no .at-surface');
  const chip = await page.getByTestId('tab-source-chip').textContent().catch(() => '');
  check('another member’s shared file shows with its chip', /File added by Tab Sharer, shared/.test(chip ?? ''), chip ?? '');
  const header = await page.getByTestId('tab-sheet-header').innerText().catch(() => '');
  check('the header reads bpm, instrument and tuning from the file', /120 bpm/.test(header) && /Distortion guitar, Drop D/.test(header), header.replace(/\s+/g, ' '));
  check('the track picker lists guitar and bass',
    (await page.getByRole('group', { name: 'Tracks' }).getByRole('button').count()) === 2);
  check('the player bar stays visible below', await page.locator('footer').isVisible());
  check('the page has no transport of its own',
    (await page.getByTestId('tabs-page').getByRole('button', { name: /^(Pause|Play|Next|Previous)$/ }).count()) === 0);

  const style = await page.evaluate(() => {
    const el = document.querySelector('.at-cursor-beat');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { w: Math.round(r.width), h: Math.round(r.height), bg: cs.backgroundColor };
  });
  check('the playhead line is visible', !!style && style.w >= 2 && style.h > 40 && style.bg !== 'rgba(0, 0, 0, 0)',
    style ? `${style.w}x${style.h} ${style.bg}` : 'no cursor');

  const a = await cursorAt(page);
  await page.waitForTimeout(3000);
  const b = await cursorAt(page);
  check('the cursor advances while the song plays', a !== null && b !== null && a !== b, `${a} -> ${b}`);

  await page.locator('footer').getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForTimeout(800);
  const p1 = await cursorAt(page);
  await page.waitForTimeout(2500);
  const p2 = await cursorAt(page);
  check('pausing from the player bar stops the cursor', p1 !== null && p1 === p2, `${p1} -> ${p2}`);
  await page.locator('footer').getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(1000);

  // Click bar 12 of the score: it starts at 22 s (120 bpm, 4/4). AlphaTab
  // only draws rows near the view, so it is a bar on screen already. Paused
  // first, so follow-scroll does not pull the page back to the cursor
  // between finding bar 12 and clicking it.
  await page.locator('footer').getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForTimeout(500);
  const before = await elapsed(page);
  const barTwelve = () => page.evaluate(() => {
    const label = [...document.querySelectorAll('[data-testid="tab-score"] text')].find((t) => t.textContent?.trim() === '12');
    if (!label) return null;
    const r = label.getBoundingClientRect();
    return { x: r.left + 40, y: r.bottom + 45 };
  });
  const first = await barTwelve();
  if (first) {
    await page.evaluate((y) => {
      const sc = document.querySelector('[data-app-scroller]');
      sc.scrollBy(0, y - sc.clientHeight / 2);
    }, first.y);
    await page.waitForTimeout(400);
  }
  const target = await barTwelve();
  if (process.env.DEBUG_TABS) {
    console.log('[bar 12]', first, target, await page.evaluate((t) => {
      const e = t && document.elementFromPoint(t.x, t.y);
      const nums = [...document.querySelectorAll('[data-testid="tab-score"] text')].map((x) => x.textContent?.trim()).filter((x) => Number(x) > 9);
      return [e?.tagName, e?.closest('.at-surface') ? 'in' : 'out', nums.slice(0, 12)];
    }, target));
  }
  if (target) await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(1500);
  const after = await elapsed(page);
  check('clicking a later bar seeks the song there', !!target && after >= 22 && after <= 25, `${before}s -> ${after}s`);
  const moved = await page.evaluate(() => {
    const label = [...document.querySelectorAll('[data-testid="tab-score"] text')].find((t) => t.textContent?.trim() === '12');
    const beat = document.querySelector('.at-cursor-beat')?.getBoundingClientRect();
    const r = label?.getBoundingClientRect();
    return !!(beat && r && Math.abs(beat.top - r.top) < 120);
  });
  check('the cursor jumps to the clicked bar while paused', moved);
  await page.locator('footer').getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(500);

  // The Sync nudge still moves the cursor against the recording.
  await page.getByRole('button', { name: 'Sync' }).click();
  await page.locator('footer').getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForTimeout(800);
  const n1 = await cursorAt(page);
  await page.getByLabel('Tab timing offset in seconds').evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '6');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(1500);
  const n2 = await cursorAt(page);
  check('the sync nudge shifts the cursor', n1 !== null && n2 !== null && n1 !== n2, `${n1} -> ${n2}`);
  await page.getByRole('button', { name: 'Reset' }).click();
  await page.locator('footer').getByRole('button', { name: 'Play', exact: true }).click();

  await page.getByRole('button', { name: 'Horizontal' }).click();
  await page.waitForTimeout(2500);
  const row = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="tab-score"]');
    return { scroll: el.dataset.scroll, sw: el.scrollWidth, cw: el.clientWidth };
  });
  check('Horizontal lays the score out as one sideways row', row.scroll === 'horizontal' && row.sw > row.cw * 2, JSON.stringify(row));
  const h1 = await page.evaluate(() => document.querySelector('[data-testid="tab-score"]').scrollLeft);
  await page.waitForTimeout(5000);
  const h2 = await page.evaluate(() => document.querySelector('[data-testid="tab-score"]').scrollLeft);
  check('horizontal follow-scroll moves sideways with the song', h2 > h1, `${h1} -> ${h2}`);
  await page.getByRole('button', { name: 'Horizontal' }).click();
  await page.context().close();
}

// ── phone: Now playing opens the page, and it fits ─────────────────────────
{
  const page = await newPage({ width: 390, height: 844 }, { hasTouch: true, isMobile: true });
  await play(page, song.title);
  // The bar's song-name row, not its text: the phone bar's title is a
  // marquee, whose invisible measuring ruler is the first text match.
  await page.locator('[data-testid="phone-player-title-row"]').click();
  await page.waitForTimeout(1000);
  await page.locator('[role="dialog"][aria-hidden="false"]').getByRole('button', { name: 'Guitar tabs' }).click();
  await page.waitForURL((u) => u.pathname === trackPath(song.id), { timeout: 10_000, waitUntil: 'commit' }).catch(() => {});
  check('phone: Now playing opens the tab page', new URL(page.url()).pathname === trackPath(song.id), page.url());
  await scoreReady(page).catch(() => {});
  await page.waitForTimeout(1500);
  const s = await surface(page);
  check('phone: the score renders at phone width', Boolean(s && s.w > 200 && s.w <= 390 && s.h > 100), s ? `${s.w}x${s.h}` : 'none');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth);
  check('phone: no sideways page scroll', overflow <= 390, `${overflow}px`);
  check('phone: the mini player stays below', await page.locator('footer').isVisible());
  await page.context().close();
}

// ── the Songsterr integration plugin toggle turns the feature off ─────────
{
  const page = await newPage({ width: 1300, height: 950 });
  await play(page, song.title);
  check('the tabs button is there before the plugin is touched',
    (await page.locator('footer').getByRole('button', { name: 'Guitar tabs' }).count()) > 0);

  await page.goto(`${APP_URL}/settings/plugins`, { waitUntil: 'networkidle' });
  const toggle = page.getByRole('button', { name: 'Turn off Songsterr integration' });
  check('the Songsterr card is tagged Work in progress', (await page.getByText('Work in progress').count()) > 0);
  await toggle.click();
  await page.waitForTimeout(300);

  check('the tabs button disappears from the player bar once off',
    (await page.locator('footer').getByRole('button', { name: 'Guitar tabs' }).count()) === 0);

  await page.goto(`${APP_URL}${trackPath(song.id)}`, { waitUntil: 'networkidle' });
  check('the tab page shows the turned-off message',
    (await page.getByText('Guitar tabs are turned off.').count()) > 0);
  check('the turned-off page links to Settings > Plugins',
    (await page.getByRole('link', { name: 'Settings > Plugins' }).getAttribute('href')) === '/settings/plugins');

  await page.goto(`${APP_URL}/settings/plugins`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Turn on Songsterr integration' }).click();
  await page.waitForTimeout(300);

  await page.goto(`${APP_URL}/library/uploads`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  check('the tabs button returns once the plugin is back on',
    (await page.locator('footer').getByRole('button', { name: 'Guitar tabs' }).count()) > 0);
  await page.context().close();
}

// ── the empty state: the Songsterr list ───────────────────────────────────
// No tab to draw: Songsterr's versions of the song to open there, or, when
// Songsterr has nothing, the places people post tabs; Add a file under
// either, and "Looking on Songsterr…" while Ember is still asking.
// tests/fake-songsterr.mjs answers any title with one song that has no
// notes to fetch (it cannot be drawn: the list) and a title with "zzfail"
// with a 503 (nothing on Songsterr: the sites). Generating a tab is gone:
// nothing offers it, and a generated row an older server left is never
// drawn. SHOT_DIR=dir saves each state, dark and light, desktop and phone.
{
  const SHOT_DIR = process.env.SHOT_DIR ?? null;
  const none = await uploadSong(`Tab Page zzfail ${run}`);
  const looking = await uploadSong(`Tab Page Looking ${run}`);
  const q = (s) => encodeURIComponent(`${s.artist} ${s.title}`).replace(/%20/g, '+');
  const settled = (page, state) => page.locator(`[data-testid="tabs-empty"][data-state="${state}"]`).waitFor({ timeout: 20_000 }).then(() => true, () => false);
  const noGenerate = async (page) => !/Generat|Transcrib/i.test(await page.locator('main').innerText().catch(() => ''));

  // A member on a light theme (a custom one, made the way Settings >
  // Appearance makes one), signed in again so the cookie carries it.
  const lightEmail = `tabsui-light-${run}@ember.test`;
  await fetch(`${PB_URL}/api/collections/users/records`, { method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: token },
    body: JSON.stringify({ email: lightEmail, password: PASSWORD, passwordConfirm: PASSWORD, name: 'Tab Light', verified: true }) });
  const signIn = () => fetch(`${PB_URL}/api/collections/users/auth-with-password`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: lightEmail, password: PASSWORD }) })
    .then((r) => r.json()).then((a) => encodeURIComponent(JSON.stringify({ token: a.token, record: a.record })));
  let light = await signIn();
  const LIGHT = { background: [0.97, 0.004, 80], surface: [0.93, 0.005, 80], text: [0.22, 0.01, 260], mutedText: [0.47, 0.01, 260],
    accent: [0.6, 0.2, 28], accentHover: [0.68, 0.16, 28], border: [0, 0, 0], sidebar: [0.94, 0.005, 80] };
  const made = await fetch(`${APP_URL}/api/themes`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `pb_auth=${light}` },
    body: JSON.stringify({ name: 'Light', base: 'ember', inputs: LIGHT }) }).then((r) => r.json()).catch(() => null);
  const used = made?.theme?.id ?? made?.id;
  const applied = used
    ? (await fetch(`${APP_URL}/api/theme`, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: `pb_auth=${light}` },
      body: JSON.stringify({ themeId: used }) })).ok
    : false;
  check('a light theme for the screenshots', applied, JSON.stringify(made).slice(0, 160));
  light = await signIn();

  async function pageAs(cookie, viewport) {
    const ctx = await browser.newContext({ viewport });
    await ctx.addCookies([{ name: 'pb_auth', value: cookie, domain: new URL(APP_URL).hostname, path: '/' }]);
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
    await ctx.route(/ultimate-guitar\.com|duckduckgo\.com|songsterr\.com/, (r) => r.fulfill({ status: 200, body: 'ok' }));
    return page;
  }
  const shoot = async (page, name) => {
    if (!SHOT_DIR) return;
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
  };
  const DESKTOP = { width: 1300, height: 950 };
  const PHONE = { width: 390, height: 844 };

  // Songsterr has the song, Ember could not draw it: the list.
  {
    const page = await pageAs(listener, DESKTOP);
    await page.goto(`${APP_URL}${trackPath(bare.id)}`, { waitUntil: 'networkidle' });
    check('Songsterr has it: the list', await settled(page, 'matches'));
    check('the list says how many', (await page.getByRole('heading', { name: '1 tab on Songsterr' }).count()) === 1);
    const rows = page.getByTestId('tabs-empty-match');
    const row = await rows.first().evaluate((a) => ({ href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel'), text: a.textContent ?? '' })).catch(() => null);
    check('each version links to its Songsterr page, in a new tab with noopener',
      (await rows.count()) === 1 && /^https:\/\/www\.songsterr\.com\/a\/wsa\/.+-tab-s\d+$/.test(row?.href ?? '') && row?.target === '_blank' && /noopener/.test(row?.rel ?? ''), row?.href ?? '');
    check('a version names its instruments and chords, and says Open',
      /Electric Guitar \(distortion\)/.test(row?.text ?? '') && /chords/.test(row?.text ?? '') && /Open$/.test(row?.text ?? ''), row?.text ?? '');
    check('one version: no Best match badge', (await page.getByText('Best match').count()) === 0);
    const other = await page.getByTestId('tab-search-links').locator('a').evaluateAll((as) => as.map((a) => [a.dataset.link, a.getAttribute('href')])).catch(() => []);
    check('under it: search Ultimate Guitar or Guitar Pro files for another version',
      other.length === 2 && other[0][0] === 'ultimate-guitar' && other[0][1] === `https://www.ultimate-guitar.com/search.php?search_type=title&value=${q(bare)}`
        && other[1][0] === 'guitar-pro' && other[1][1] === `https://duckduckgo.com/?q=${q(bare)}+(gp5+OR+gpx+OR+"guitar+pro")`, JSON.stringify(other));
    check('no Generate anywhere on the page', await noGenerate(page));
    await page.getByRole('button', { name: 'Tab options' }).click();
    await page.getByRole('menuitem').first().waitFor({ timeout: 5000 }).catch(() => {});
    const items = await page.getByRole('menuitem').allInnerTexts().catch(() => []);
    check('the ⋯ menu offers no Generate', items.length > 0 && !items.some((t) => /Generat/i.test(t)), items.join(' | '));
    await page.keyboard.press('Escape');
    await shoot(page, 'empty-matches-dark-desktop');

    const popup = page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null);
    await rows.first().click();
    const opened = await popup;
    check('a click opens the version on Songsterr', !!opened && opened.url() === row?.href, opened?.url() ?? 'nothing opened');
    await opened?.close();

    // Add a file, from the empty state itself: the tab is drawn at once.
    await page.locator('input[aria-label="Tab file"]').setInputFiles({ name: 'mine.gp', mimeType: 'application/octet-stream', buffer: await makeGp() });
    await scoreReady(page).catch(() => {});
    const chip = await page.getByTestId('tab-source-chip').textContent().catch(() => '');
    check('Add a file: the file is drawn, with its chip', /File added by you, shared/.test(chip ?? ''), chip ?? '');
    const s = await surface(page);
    check('AlphaTab draws it', Boolean(s && s.w > 100 && s.h > 50), s ? `${s.w}x${s.h}` : 'none');
    check('a song that is not playing says so', (await page.getByText(/This song is not playing/).count()) > 0);
    await page.context().close();
  }

  // Nothing on Songsterr: the places people post tabs.
  {
    const page = await pageAs(listener, DESKTOP);
    await page.goto(`${APP_URL}${trackPath(none.id)}`, { waitUntil: 'networkidle' });
    check('nothing on Songsterr: the sites', await settled(page, 'none'));
    check('it says so', (await page.getByRole('heading', { name: 'Nothing on Songsterr' }).count()) === 1);
    const sites = await page.getByTestId('tabs-empty-site').evaluateAll((as) => as.map((a) => ({ link: a.dataset.link, href: a.getAttribute('href'), target: a.getAttribute('target'), text: a.textContent ?? '' }))).catch(() => []);
    check('Ultimate Guitar and Guitar Pro files, searching for the song, in a new tab',
      sites.length === 2 && sites[0].link === 'ultimate-guitar' && sites[0].href === `https://www.ultimate-guitar.com/search.php?search_type=title&value=${q(none)}`
        && sites[1].link === 'guitar-pro' && sites.every((x) => x.target === '_blank' && /Search$/.test(x.text)), JSON.stringify(sites).slice(0, 300));
    check('no Songsterr version and no "another version" line', (await page.getByTestId('tabs-empty-match').count()) === 0 && (await page.getByTestId('tab-search-links').count()) === 0);
    check('Add a file is there', await page.getByRole('button', { name: 'Add a file' }).isEnabled().catch(() => false));
    check('no Generate here either', await noGenerate(page));
    const popup = page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null);
    await page.getByTestId('tabs-empty-site').first().click();
    const opened = await popup;
    check('a site opens its search for the song', !!opened && opened.url().includes('www.ultimate-guitar.com') && opened.url().includes('zzfail'), opened?.url() ?? 'nothing opened');
    await opened?.close();
    await shoot(page, 'empty-none-dark-desktop');
    await page.context().close();
  }

  // Still looking: Songsterr's answer held back until the page has shown it.
  const hold = async (page) => {
    let release = () => {};
    const gate = new Promise((r) => (release = r));
    await page.route(/\/api\/tabs\?title=/, async (r) => { await gate; await r.continue(); });
    return () => release();
  };
  {
    const page = await pageAs(listener, DESKTOP);
    const release = await hold(page);
    await page.goto(`${APP_URL}${trackPath(looking.id)}`, { waitUntil: 'domcontentloaded' });
    check('still looking: Looking on Songsterr…', await settled(page, 'searching'));
    const status = await page.getByRole('status').filter({ hasText: 'Looking on Songsterr' }).count();
    check('said as a status, over a list of placeholders',
      status === 1 && (await page.locator('[data-testid="tabs-empty-list"][aria-busy="true"] li').count()) === 3);
    check('Add a file already offered', await page.getByRole('button', { name: 'Add a file' }).isEnabled().catch(() => false));
    await shoot(page, 'empty-searching-dark-desktop');
    release();
    check('then the list, once Songsterr answers', await settled(page, 'matches'));
    await page.context().close();
  }

  // Phone: the rows end in a chevron, and nothing runs off the side.
  {
    const page = await pageAs(listener, PHONE);
    await page.goto(`${APP_URL}${trackPath(looking.id)}`, { waitUntil: 'networkidle' });
    await settled(page, 'matches');
    const end = await page.getByTestId('tabs-empty-match').first().evaluate((a) => a.lastElementChild?.tagName.toLowerCase()).catch(() => null);
    check('phone: a chevron instead of Open', end === 'svg' && (await page.getByText('Open', { exact: true }).count()) === 0, String(end));
    const scroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    check('phone: no sideways page scroll', scroll.sw <= scroll.iw, `${scroll.sw} in ${scroll.iw}`);
    await shoot(page, 'empty-matches-dark-phone');
    await page.goto(`${APP_URL}${trackPath(none.id)}`, { waitUntil: 'networkidle' });
    await settled(page, 'none');
    await shoot(page, 'empty-none-dark-phone');
    const release = await hold(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await settled(page, 'searching');
    await shoot(page, 'empty-searching-dark-phone');
    release();
    await page.context().close();
  }

  // The light theme, desktop and phone, every state.
  for (const [viewport, tag] of [[DESKTOP, 'desktop'], [PHONE, 'phone']]) {
    const page = await pageAs(light, viewport);
    await page.goto(`${APP_URL}${trackPath(looking.id)}`, { waitUntil: 'networkidle' });
    check(`light ${tag}: the list`, await settled(page, 'matches'));
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const lum = (() => { const m = bg.match(/[\d.]+/g)?.map(Number) ?? []; return m.length >= 3 ? (m[0] + m[1] + m[2]) / 3 : 0; })();
    check(`light ${tag}: the page is light`, bg.startsWith('oklch') ? Number(bg.match(/oklch\(([\d.]+)/)?.[1] ?? 0) > 0.8 : lum > 200, bg);
    await shoot(page, `empty-matches-light-${tag}`);
    await page.goto(`${APP_URL}${trackPath(none.id)}`, { waitUntil: 'networkidle' });
    await settled(page, 'none');
    await shoot(page, `empty-none-light-${tag}`);
    const release = await hold(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await settled(page, 'searching');
    await shoot(page, `empty-searching-light-${tag}`);
    release();
    await page.context().close();
  }

  // A generated tab an older server left: kept, never drawn or served.
  {
    const gen = await uploadSong(`Tab Page Generated ${run}`);
    const sharedFile = (await (await fetch(`${APP_URL}/api/tabs/files?kind=all&trackId=${encodeURIComponent(song.id)}`, { headers: { cookie: `pb_auth=${listener}` } })).json()).tabs?.[0];
    const row = await fetch(`${PB_URL}/api/collections/tabs/records`, { method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: token },
      body: JSON.stringify({ title: gen.title, artist: gen.artist, instrument: 'Guitar', file: 'upload-old.alphatex', kind: 'generated',
        format: 'alphatex', shared: true, song_key: '', track_key: gen.id, offset_ms: 0 }) }).then((r) => r.json());
    const onSong = await fetch(`${PB_URL}/api/collections/tabs/records`, { method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: token },
      body: JSON.stringify({ title: song.title, artist: song.artist, instrument: 'Guitar', file: 'upload-old2.alphatex', kind: 'generated',
        format: 'alphatex', shared: true, song_key: '', track_key: song.id, offset_ms: 0 }) }).then((r) => r.json());
    check('seeded two generated rows', !!row.id && !!onSong.id && !!sharedFile, JSON.stringify(row).slice(0, 120));
    const as = (u) => fetch(`${APP_URL}${u}`, { headers: { cookie: `pb_auth=${listener}` } });
    const listed = (await (await as(`/api/tabs/files?kind=all&trackId=${encodeURIComponent(gen.id)}`)).json()).tabs ?? [];
    check('the store lists no generated tab', listed.length === 0, JSON.stringify(listed).slice(0, 120));
    check('a stale download link to one is a 410', (await as(`/api/tabs/files/${row.id}/download`)).status === 410);
    check('the old generate route is gone (404)', (await as(`/api/tabs/generated/${encodeURIComponent(gen.id)}`)).status === 404);
    check('and so is the tools probe (404)', (await as('/api/tabs/tools')).status === 404);

    const page = await pageAs(listener, DESKTOP);
    await page.goto(`${APP_URL}${trackPath(gen.id)}`, { waitUntil: 'networkidle' });
    check('a song whose only tab was generated: the empty state, no score',
      (await page.locator('[data-testid="tabs-empty"]:not([data-state="searching"])').waitFor({ timeout: 20_000 }).then(() => true, () => false))
        && (await page.getByTestId('tab-score').count()) === 0);
    // This device picked the generated tab back when it was drawn.
    await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [`ember.tab.pick.${song.id}`, onSong.id]);
    await page.goto(`${APP_URL}${trackPath(song.id)}`, { waitUntil: 'networkidle' });
    await scoreReady(page).catch(() => {});
    const chip = await page.getByTestId('tab-source-chip').textContent().catch(() => '');
    check('a stale pick of a generated tab falls back to the shared file', /File added by Tab Sharer/.test(chip ?? ''), chip ?? '');
    await page.getByRole('button', { name: 'Choose a tab' }).click();
    await page.getByTestId('tab-source-row').first().waitFor({ timeout: 10_000 }).catch(() => {});
    const sheet = await page.getByTestId('tab-source-sheet').innerText().catch(() => '');
    check('the Source sheet lists no generated tab and no Generate', !/Generat|rough/i.test(sheet), sheet.replace(/\s+/g, ' ').slice(0, 160));
    await page.context().close();
  }
}

// ── every shape of tab draws, with no console error ───────────────────────
// A file that only carries standard notation (a MusicXML export with no
// string and fret numbers) has no tablature staff. Asked for AlphaTab's Tab
// stave profile it lays out an empty system and throws
// ("can't access property staves"), so the page drew nothing at all; the
// score staff is kept for such a file instead. The same section walks a
// multi-track file, a pasted text tab, the instrument picker, Tab and
// Tab + Score, and switching between the sources, and every step has to
// leave the console clean.
{
  const shapes = await uploadSong(`Tab Shapes ${run}`);
  const at = await import(path.join(process.cwd(), 'node_modules/@coderline/alphatab/dist/alphaTab.mjs'));

  /** A Guitar Pro 7 file with one instrument per name, like a Songsterr part list. */
  const multiTrack = (names) => {
    const bars = Array(12).fill('0.6.8 3.6.8 5.6.8 3.6.8').join(' |\n');
    const tex = `\\title "Shapes"\n\\tempo 120\n${names
      .map((n, i) => `\\track ("${n}" "${n.slice(0, 6)}")\n\\instrument ${30 + i}\n\\tuning (E4 B3 G3 D3 A2 E2)\n\\ts (4 4)\n${bars}\n`)
      .join('')}`;
    const settings = new at.Settings();
    const imp = new at.importer.AlphaTexImporter();
    imp.initFromString(tex, settings);
    return Buffer.from(new at.exporter.Gp7Exporter().export(imp.readScore(), settings));
  };
  /** Standard notation only: no string or fret numbers anywhere. */
  const SCORE_ONLY = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

  const addFile = async (bytes, name, title) => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)]), name);
    form.append('title', title);
    form.append('artist', shapes.artist);
    form.append('trackId', shapes.id);
    const res = await fetch(`${APP_URL}/api/tabs/files`, { method: 'POST', body: form, headers: { cookie: `pb_auth=${listener}` } });
    if (!res.ok) throw new Error(`could not add ${name}: ${res.status} ${(await res.text()).slice(0, 160)}`);
  };
  await addFile(multiTrack(['Lead Guitar', 'Rhythm Guitar', 'Guitar Harmonies', 'Bass']), 'multi.gp', `${shapes.title} multi`);
  await addFile(Buffer.from(SCORE_ONLY, 'utf8'), 'score-only.musicxml', `${shapes.title} score only`);
  {
    const text = ['e|-----------------|', 'B|-----------------|', 'G|-----------------|', 'D|---------2---4---|', 'A|-----0---2-------|', 'E|-3---------------|'].join('\n');
    const res = await fetch(`${APP_URL}/api/tabs/text`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `pb_auth=${listener}` },
      body: JSON.stringify({ text, title: `${shapes.title} text`, artist: shapes.artist, trackId: shapes.id }),
    });
    if (res.status !== 201) throw new Error(`could not paste the text tab: ${res.status}`);
  }

  const page = await newPage({ width: 1440, height: 950 });
  // This section's own console, so a step names the step that made the noise.
  const mine = [];
  page.on('console', (m) => { if (m.type() === 'error') mine.push(m.text()); });
  page.on('pageerror', (e) => mine.push(`pageerror: ${e.message}`));
  const quiet = () => mine.filter((e) => !/favicon|404/.test(e));
  const drew = async () => {
    const s = await surface(page);
    return Boolean(s && s.w > 300 && s.h > 40);
  };
  const sources = async () => {
    await page.getByRole('button', { name: 'Choose a tab' }).click();
    await page.getByTestId('tab-source-row').first().waitFor({ timeout: 10_000 });
    return page.getByTestId('tab-source-row').evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ')));
  };
  const pickSource = async (rows, needle) => {
    const n = rows.findIndex((r) => r.includes(needle));
    if (n < 0) throw new Error(`no source matching ${needle} in ${JSON.stringify(rows)}`);
    await page.getByTestId('tab-source-row').nth(n).getByRole('radio').click();
    await scoreReady(page).catch(() => {});
    await page.waitForTimeout(1200);
  };

  await page.goto(`${APP_URL}${trackPath(shapes.id)}`, { waitUntil: 'networkidle' });
  await scoreReady(page).catch(() => {});
  const rows = await sources();

  await pickSource(rows, 'multi');
  check('a multi-track file draws', await drew());
  const pills = page.getByRole('group', { name: 'Tracks' }).getByRole('button');
  check('and lists its four instruments', (await pills.count()) === 4, `${await pills.count()} pills`);
  await pills.nth(3).click();
  await page.waitForTimeout(2000);
  check('switching instrument keeps it drawn', await drew());
  for (const label of ['Tab + Score', 'Tab']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForTimeout(1800);
    check(`${label} keeps it drawn`, await drew());
  }

  await pickSource(await sources(), 'score only');
  check('a file with no tablature draws too, in Tab', await drew());
  check('and says nothing went wrong', (await page.getByTestId('tab-score').getByRole('alert').count()) === 0,
    (await page.getByTestId('tab-score').innerText()).slice(0, 120));

  await pickSource(await sources(), 'text');
  check('a pasted text tab draws', await drew());

  // Back to the widest file and away again: the picker is filled from the
  // score on screen, so this is where a stale instrument index used to
  // reach AlphaTab and make it render no track at all.
  await pickSource(await sources(), 'multi');
  await pickSource(await sources(), 'score only');
  check('switching back and forth between sources stays drawn', await drew());

  check('every shape of tab drew with a clean console', quiet().length === 0, quiet().slice(0, 3).join(' | '));
  await page.context().close();
}

// ── nothing overflows ──────────────────────────────────────────────────────
// A long song name, a member with a 60-character name, a file with six
// long-named tracks and seven pasted tabs: eight lines in the picker. At
// 390, 1280 and 1920 every chip, menu item and picker line ends inside the
// window, and the page never scrolls sideways (the toolbar scrolls inside
// itself, so its row is checked, not each pill).
{
  const LONG_NAME = 'Maximiliana Wolkenstein-Hohenberg of the Harbour Lantern Choir';
  const longMember = await member('longname', LONG_NAME);
  const longSong = await uploadSong(`A Very Long Song Name That Keeps Going Well Past Any Sensible Header Width ${run}`);
  {
    const at = await import(path.join(process.cwd(), 'node_modules/@coderline/alphatab/dist/alphaTab.mjs'));
    const names = ['Rhythm Guitar (Fender Jaguar, fuzz, left channel)', 'Lead Guitar (Gibson SG, wah, right channel)',
      'Acoustic Guitar (12-string, intro and outro only)', 'Baritone Guitar (tuned to B standard, doubles the bass)',
      'Electric Bass (finger, flatwound strings, chorus pedal)', 'Slide Guitar (open G, glass slide, bridge solo)'];
    const tracks = names.map((n) => `\\track ("${n}" "${n.slice(0, 6)}")\n\\tuning (E4 B3 G3 D3 A2 E2)\n${Array(8).fill('0.6.4 2.6.4 3.6.4 5.6.4').join(' |\n')}\n`).join('');
    const settings = new at.Settings();
    const imp = new at.importer.AlphaTexImporter();
    imp.initFromString(`\\title "Long"\n\\tempo 120\n${tracks}`, settings);
    const gp = Buffer.from(new at.exporter.Gp7Exporter().export(imp.readScore(), settings));
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(gp)]), 'long.gp');
    form.append('title', longSong.title);
    form.append('artist', longSong.artist);
    form.append('trackId', longSong.id);
    const up = await fetch(`${APP_URL}/api/tabs/files`, { method: 'POST', body: form, headers: { cookie: `pb_auth=${longMember}` } });
    if (!up.ok) throw new Error(`could not add the long file: ${up.status}`);
  }
  const RIFF = ['e|-----------------|', 'B|-----------------|', 'G|-----------------|', 'D|---------2---4---|', 'A|-----0---2-------|', 'E|-3---------------|'].join('\n');
  for (let i = 0; i < 7; i++) {
    const res = await fetch(`${APP_URL}/api/tabs/text`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `pb_auth=${longMember}` },
      body: JSON.stringify({ text: RIFF, title: longSong.title, artist: longSong.artist, trackId: longSong.id }),
    });
    if (res.status !== 201) throw new Error(`could not paste tab ${i}: ${res.status}`);
  }

  /** Every element matching the selector, as {text, left, right}. */
  const rects = (page, selector) => page.evaluate((sel) => [...document.querySelectorAll(sel)].map((el) => {
    const r = el.getBoundingClientRect();
    return { text: (el.textContent ?? '').trim().slice(0, 40), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) };
  }), selector);
  const outside = (list, width) => list.filter((x) => x.w > 0 && (x.right > width || x.left < 0));

  for (const width of [390, 1280, 1920]) {
    const phone = width < 640;
    const page = await newPage({ width, height: 900 }, phone ? { hasTouch: true, isMobile: true } : {});
    await page.goto(`${APP_URL}${trackPath(longSong.id)}`, { waitUntil: 'networkidle' });
    await scoreReady(page).catch(() => {});
    await page.waitForTimeout(800);

    const header = await rects(page, '[data-testid="tab-sheet-header"] h1, [data-testid="tab-sheet-header"] .text-meta, [data-testid="tab-source-chip"], [data-testid="tabs-toolbar"]');
    check(`${width}: title, meta, chip and toolbar end inside the window`, header.length >= 4 && outside(header, width).length === 0,
      JSON.stringify(outside(header, width)).slice(0, 200));
    const chipLabel = await page.getByTestId('tab-source-chip').innerText().catch(() => '');
    check(`${width}: the chip names the long-named member`, chipLabel.includes('File added by Maximiliana'), chipLabel.slice(0, 60));

    await page.getByRole('button', { name: 'Tab options' }).click();
    await page.getByRole('menuitem').first().waitFor({ timeout: 5000 }).catch(() => {});
    const menu = await rects(page, '[role="menuitem"]');
    check(`${width}: every ⋯ menu item ends inside the window`, menu.length >= 5 && outside(menu, width).length === 0,
      `${menu.length} items ${JSON.stringify(outside(menu, width)).slice(0, 160)}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // The Source sheet: the same eight tabs, a
    // card each, inside a side sheet on desktop and a bottom sheet on phone.
    await page.getByRole('button', { name: 'Choose a tab' }).click();
    await page.getByTestId('tab-source-row').first().waitFor({ timeout: 10_000 }).catch(() => {});
    const sheet = await rects(page, '[data-testid="tab-source-sheet"], [data-testid="tab-source-row"], [data-testid="tab-source-sheet"] button');
    const cards = await page.getByTestId('tab-source-row').count();
    const titled = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="tab-source-row"]')].every((el) => !!el.querySelector('[title]')));
    check(`${width}: all eight sources end inside the window`, cards === 8 && outside(sheet, width).length === 0,
      `${cards} cards, ${sheet.length} boxes ${JSON.stringify(outside(sheet, width)).slice(0, 160)}`);
    check(`${width}: a cut name keeps its whole text in the tooltip`, titled);
    await page.getByRole('button', { name: 'Close the tab list' }).first().click();
    await page.waitForTimeout(300);

    const scroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    check(`${width}: no sideways page scroll`, scroll.sw <= scroll.iw, `page ${scroll.sw}px in a ${scroll.iw}px window`);
    await page.context().close();
  }
}

// A 404 in the browser (an image or lyrics miss) is not an error of the page.
const noisy = consoleErrors.filter((e) => !/favicon|404/.test(e));
check('no unexpected console errors', noisy.length === 0, noisy.slice(0, 2).join(' | '));

await browser.close();
const failed = checks.filter(([, p]) => !p);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map(([n]) => n).join(', '));
process.exit(failed.length ? 1 : 0);
