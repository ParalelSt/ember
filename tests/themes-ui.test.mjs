/** Themes follow the account and paint from the first HTML byte
 *  (docs/superpowers/plans/2026-09-23-themes.md, Task 2).
 *
 *      npm i -D playwright-core
 *      node tests/themes-ui.test.mjs        # or: npm run test:themes-ui
 *
 *  Ember with nothing saved is exactly globals.css (no inline overrides).
 *  A preset picked on the account is in the server's HTML, and a browser
 *  with JavaScript OFF shows it (nothing but HTML and CSS produced it), on
 *  this device and on a fresh one. A cached theme on a device never
 *  flashes before the account's. Saved themes: create, the cap, the
 *  unreadable refusal, sharing with a second person who sees it (by name)
 *  and can use it but not change it, unsharing leaving them their copy,
 *  and the collection rules straight through /pb. Back to Ember clears
 *  every override; signed-out pages are Ember whatever is cached.
 *
 *  Choices a person makes (a preset, a custom theme, sharing, using and
 *  copying someone else's) go through Settings > Appearance in the
 *  browser; the refusals and the collection rules go straight at the
 *  routes and /pb. Every preset is walked through Home, Appearance, Help
 *  and Plugins at 390 and 1300 wide: nothing scrolls sideways, and
 *  everything painted on the accent (text, icons, switch thumbs) stands
 *  off it, which is what catches a white-on-white play button on Mono.
 *  With SHOT_DIR set, each of those is photographed.
 *
 *  Needs a sandbox: PocketBase (PB_URL) started with this branch's
 *  pb_hooks (ensure_themes.pb.js), and the app (APP_URL) built from this
 *  tree pointed at it with the PB admin credentials. Set CHROME_PATH to
 *  pick a browser. */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('This test needs playwright-core:\n\n  npm i -D playwright-core\n');
  process.exit(2);
}

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8089';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3051';
const PASSWORD = 'ThemesTest2026!';
const THEME_KEY = 'ember.theme.v1';
const HERE = path.dirname(fileURLToPath(import.meta.url));

// Midnight, as lib/theme derives it.
const MIDNIGHT = { background: 'oklch(0.17 0.03 262)', ember: 'oklch(0.75 0.14 225)', themeColor: '#080f1c' };
const MIDNIGHT_INPUTS = {
  background: [0.17, 0.03, 262], surface: [0.21, 0.03, 262], text: [0.97, 0.01, 250], mutedText: [0.7, 0.02, 255],
  accent: [0.75, 0.14, 225], accentHover: [0.83, 0.1, 225], border: [1, 0, 0], sidebar: [0.14, 0.03, 262],
};
// A custom theme: Midnight with a violet accent, typed into the page as hex.
const VIOLET = '#a07cf0';
// The accent pushed onto the background: links and buttons unreadable.
const MURKY_HEX = '#141c2c';
const PRESETS = ['ember', 'midnight', 'forest', 'nebula', 'mono'];
const SHOT_DIR = process.env.SHOT_DIR;
/** The CSS lib/theme writes for a stored colour (already at storage precision). */
const css = ([l, c, h]) => `oklch(${l} ${c} ${h})`;
const MURKY = { ...MIDNIGHT_INPUTS, accent: [0.24, 0.05, 262], accentHover: [0.3, 0.05, 262] };

/** globals.css :root colour tokens, var() references resolved. */
function rootTokens() {
  const css = fs.readFileSync(path.join(HERE, '../apps/web/app/globals.css'), 'utf8');
  const block = /(?:^|\n):root\s*\{([\s\S]*?)\n\}/.exec(css)[1].replace(/\/\*[\s\S]*?\*\//g, '');
  const vars = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  const resolve = (v) => { const r = /^var\((--[\w-]+)\)$/.exec(v); return r ? resolve(vars[r[1]]) : v; };
  return Object.fromEntries(Object.entries(vars).filter(([, v]) => /oklch\(/.test(resolve(v))).map(([k, v]) => [k, resolve(v)]));
}
const TOKENS = rootTokens();
const THEME_VARS = Object.keys(TOKENS);

/** Two oklch() strings as numbers: the production CSS build minifies the
 *  tokens (`oklch(16% .005 260)`, `/.08`), the source spells them out. */
function oklchNums(css) {
  const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/.exec(css.trim());
  if (!m) return null;
  const alpha = m[5] === undefined ? 1 : Number(m[5]) / (m[6] ? 100 : 1);
  return [Number(m[1]) / (m[2] ? 100 : 1), Number(m[3]), Number(m[4]), alpha];
}
const sameColour = (a, b) => {
  const x = oklchNums(a ?? '');
  const y = oklchNums(b ?? '');
  return !!x && !!y && x.every((n, i) => Math.abs(n - y[i]) < 1e-6);
};

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

/** A fresh member, signed in: { id, token, cookie } (cookie = the pb_auth value). */
async function member(tag, name) {
  const email = `themesui-${tag}-${run}@ember.test`;
  const made = await fetch(`${PB_URL}/api/collections/users/records`, { method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: token },
    body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name, verified: true }) }).then((r) => r.json());
  const login = async () => {
    const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PASSWORD }) })
      .then((r) => r.json());
    return { token: auth.token, cookie: encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record })) };
  };
  return { id: made.id, email, login, ...(await login()) };
}

/** A route call with this person's cookie: { status, body }. */
async function call(who, method, route, body) {
  const res = await fetch(`${APP_URL}/api${route}`, { method,
    headers: { cookie: `pb_auth=${who.cookie}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Straight to PocketBase through the app's /pb proxy, as a browser could. */
async function pbDirect(who, method, route, body) {
  const res = await fetch(`${APP_URL}/pb/api${route}`, { method,
    headers: { Authorization: who.token, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });

/** A "device": its own context and localStorage, signed in with `cookie`. */
async function device(cookie, { js = true, init } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, javaScriptEnabled: js });
  if (cookie) await ctx.addCookies([{ name: 'pb_auth', value: cookie, domain: new URL(APP_URL).hostname, path: '/' }]);
  if (init) await ctx.addInitScript(init.fn, init.arg);
  return ctx.newPage();
}

/** What the page's <html> carries: the computed tokens, inline style, meta,
 *  and the body's background next to the same colour computed from the
 *  current --background token (a probe element), so they compare exactly. */
const paint = (page) => page.evaluate((names) => {
  const html = document.documentElement;
  const cs = getComputedStyle(html);
  const probe = document.createElement('div');
  probe.style.backgroundColor = cs.getPropertyValue('--background').trim();
  document.body.appendChild(probe);
  const tokenBg = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return {
    tokens: Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()])),
    inline: names.filter((n) => html.style.getPropertyValue(n) !== ''),
    styleAttr: html.getAttribute('style'),
    dark: html.classList.contains('dark'),
    meta: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute('content')),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    tokenBg,
  };
}, THEME_VARS);

/** The pb_auth cookie's record.theme in a context, once it settles on `want`. */
async function cookieTheme(page, want, timeout = 8000) {
  const deadline = Date.now() + timeout;
  let theme;
  while (Date.now() < deadline) {
    const c = (await page.context().cookies()).find((x) => x.name === 'pb_auth');
    try { theme = JSON.parse(decodeURIComponent(c?.value ?? '')).record?.theme ?? null; } catch { theme = undefined; }
    if (!want || JSON.stringify(theme) === JSON.stringify(want)) return theme;
    await new Promise((r) => setTimeout(r, 200));
  }
  return theme;
}

async function freshCookie(page) {
  return (await page.context().cookies()).find((x) => x.name === 'pb_auth')?.value;
}

const rootVar = (page, name) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

/** Settings > Appearance, with the lists loaded. */
async function appearance(page) {
  await page.goto(`${APP_URL}/settings/appearance`, { waitUntil: 'networkidle' });
  await page.getByTestId('theme-count').waitFor({ timeout: 10000 });
}

/** The save line, once it says `text` (or null when it never does). */
async function saveLine(page, text, timeout = 8000) {
  const line = page.getByTestId('save-status');
  try {
    await line.filter({ hasText: text }).waitFor({ timeout });
  } catch {
    return null;
  }
  return line.textContent();
}

const tab = (page, name) => page.getByRole('tab', { name, exact: true }).click();

async function typeHex(page, label, hex) {
  const field = page.getByLabel(`${label} hex`, { exact: true });
  await field.fill(hex);
  await field.press('Enter');
}

// ── 1. Ember with nothing saved is exactly today's CSS ───────────────────
const aron = await member('aron', 'Aron');
{
  const got = await call(aron, 'GET', '/theme');
  check('a new account is on Ember', got.status === 200 && JSON.stringify(got.body) === '{"v":1,"preset":"ember"}', JSON.stringify(got.body));

  const page = await device(aron.cookie);
  await page.goto(`${APP_URL}/`, { waitUntil: 'networkidle' });
  const p = await paint(page);
  const off = THEME_VARS.filter((n) => !sameColour(p.tokens[n], TOKENS[n]));
  check('Ember: every colour token equals globals.css :root', off.length === 0, off.map((n) => `${n}=${p.tokens[n]}`).join(', '));
  check('Ember: no inline theme variables, no style attribute on <html>', p.inline.length === 0 && !p.styleAttr, String(p.styleAttr));
  check('Ember: <html> keeps the dark class', p.dark);
  check('Ember: body paints the globals.css background', p.bodyBg === p.tokenBg, `${p.bodyBg} vs ${p.tokenBg}`);
  check('Ember: theme-color is its background', JSON.stringify(p.meta) === '["#0c0d0f"]', JSON.stringify(p.meta));
  await page.context().close();
}

// ── 2. A preset on the account paints from the first byte ────────────────
{
  // Device A picks Midnight in Settings > Appearance.
  const a = await device(aron.cookie);
  await appearance(a);
  await a.getByRole('radio', { name: /Midnight/ }).click();
  check('Appearance: picking Midnight says Saved', (await saveLine(a, 'Saved')) === 'Saved');
  check('Appearance: Midnight is the checked preset', (await a.getByRole('radio', { name: /Midnight/ }).getAttribute('aria-checked')) === 'true');
  check('GET /api/theme says Midnight', JSON.stringify((await call(aron, 'GET', '/theme')).body) === '{"v":1,"preset":"midnight"}');

  await a.goto(`${APP_URL}/`, { waitUntil: 'networkidle' });
  const p = await paint(a);
  check('A: --background is Midnight', p.tokens['--background'] === MIDNIGHT.background, p.tokens['--background']);
  check('A: --ember is Midnight\'s accent', p.tokens['--ember'] === MIDNIGHT.ember, p.tokens['--ember']);
  const inCookie = await cookieTheme(a, { v: 1, preset: 'midnight' });
  check('A: the pb_auth cookie now carries the theme', inCookie?.preset === 'midnight', JSON.stringify(inCookie));
  const aCookie = await freshCookie(a);
  aron.cookie = aCookie;

  // Server-side proof: the first HTML byte already has the variables.
  const html = await fetch(`${APP_URL}/`, { headers: { cookie: `pb_auth=${aCookie}` } }).then((r) => r.text());
  const htmlTag = /<html[^>]*>/.exec(html)?.[0] ?? '';
  check('the server HTML <html> carries Midnight inline', htmlTag.includes(`--background:${MIDNIGHT.background}`), htmlTag.slice(0, 160));
  check('the server HTML theme-color is Midnight\'s background', html.includes(`<meta name="theme-color" content="${MIDNIGHT.themeColor}"/>`));

  // JavaScript off: nothing but the HTML and CSS can produce the colours.
  const noJs = await device(aCookie, { js: false });
  await noJs.goto(`${APP_URL}/`, { waitUntil: 'domcontentloaded' });
  const q = await noJs.evaluate(() => ({
    bg: getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),
    ember: getComputedStyle(document.documentElement).getPropertyValue('--ember').trim(),
    body: getComputedStyle(document.body).backgroundColor,
  })).catch(() => null);
  // With JS off, evaluate still runs (it is the harness, not the page).
  check('JS off: Midnight on the first document', q?.bg === MIDNIGHT.background && q?.ember === MIDNIGHT.ember, JSON.stringify(q));
  await noJs.context().close();

  // A fresh device: empty localStorage, a cookie from a new sign-in.
  const second = await aron.login();
  const b = await device(second.cookie, { js: false });
  await b.goto(`${APP_URL}/`, { waitUntil: 'domcontentloaded' });
  const bBg = await b.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--background').trim());
  check('fresh device B (JS off): Midnight on its first document', bBg === MIDNIGHT.background, bBg);
  await b.context().close();

  // A device whose cache says Mono: the account's Midnight paints first and
  // Mono never reaches the page.
  const c = await device(aCookie, {
    init: {
      fn: ([key]) => {
        localStorage.setItem(key, JSON.stringify({ state: { doc: { v: 1, preset: 'mono' } }, version: 0 }));
        window.__seen = [];
        const note = () => window.__seen.push(getComputedStyle(document.documentElement).getPropertyValue('--background').trim());
        document.addEventListener('DOMContentLoaded', note);
        window.addEventListener('ember:theme', note);
      },
      arg: [THEME_KEY],
    },
  });
  await c.goto(`${APP_URL}/`, { waitUntil: 'networkidle' });
  const seen = await c.evaluate(() => window.__seen);
  check('a stale Mono cache never flashes before the account\'s Midnight',
    seen.length > 0 && seen.every((v) => v === MIDNIGHT.background), JSON.stringify(seen));
  const cached = await c.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}').state?.doc, THEME_KEY);
  check('and the device cache is corrected to Midnight', cached?.preset === 'midnight', JSON.stringify(cached));
  await c.context().close();

  // Switching presets on a live page: A's store follows a change made
  // elsewhere on its next load.
  await call(aron, 'PATCH', '/theme', { preset: 'forest' });
  await a.reload({ waitUntil: 'networkidle' });
  const forestBg = await a.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--background').trim());
  check('A after reload: switched to Forest', forestBg === 'oklch(0.17 0.02 150)', forestBg);
  await a.context().close();
}

// ── 3. Saved themes: make one on the page, the refusals, the cap ─────────
let nightDrive;
let NIGHT_DRIVE_EMBER;
{
  const page = await device(aron.cookie);
  await appearance(page);
  await page.getByRole('radio', { name: /Midnight/ }).click();
  await saveLine(page, 'Saved');
  await tab(page, 'Colours');
  await typeHex(page, 'Accent', VIOLET);
  // Live on the whole app before anything is saved.
  const live = await rootVar(page, '--ember');
  check('a colour change shows on the whole app at once', live !== MIDNIGHT.ember && live.startsWith('oklch('), live);
  check('editing a preset saves a new theme of mine', (await saveLine(page, 'Saved as My Midnight')) === 'Saved as My Midnight');

  await tab(page, 'Themes');
  await page.getByRole('button', { name: 'Rename My Midnight' }).click();
  await page.getByLabel('New name for My Midnight').fill('Night drive');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Use Night drive' }).waitFor({ timeout: 5000 });
  check('the count reads 1 of 20', (await page.getByTestId('theme-count').textContent()) === '1 of 20');

  const mineNow = await call(aron, 'GET', '/themes');
  nightDrive = mineNow.body?.mine?.find((t) => t.name === 'Night drive');
  check('saved to the account, renamed, not shared', !!nightDrive && nightDrive.shared === false && nightDrive.base === 'midnight', JSON.stringify(mineNow.body?.mine));
  NIGHT_DRIVE_EMBER = css(nightDrive.inputs.accent);
  const active = await call(aron, 'GET', '/theme');
  check('and it is the active theme', active.body?.themeId === nightDrive.id && active.body?.name === 'Night drive', JSON.stringify(active.body));
  const ember = await rootVar(page, '--ember');
  check('the page paints the custom accent', ember === NIGHT_DRIVE_EMBER, `${ember} vs ${NIGHT_DRIVE_EMBER}`);

  // An unreadable accent: shown, explained, never saved.
  await tab(page, 'Colours');
  await typeHex(page, 'Accent', MURKY_HEX);
  const blocked = await saveLine(page, 'Not saved: accent links on the background is hard to read.');
  check('Appearance: an unreadable pair blocks the save in plain words', !!blocked, String(blocked));
  const finding = page.getByTestId('finding').filter({ hasText: 'Accent links on the background' });
  check('with the finding and its Fix it', (await finding.getAttribute('data-level')) === 'fail' && (await finding.getByRole('button', { name: 'Fix it' }).count()) === 1);
  await page.waitForTimeout(1200);
  const untouched = (await call(aron, 'GET', '/themes')).body?.mine?.find((t) => t.id === nightDrive.id);
  check('nothing reached the account', JSON.stringify(untouched?.inputs) === JSON.stringify(nightDrive.inputs));
  // Back to the saved colours, so the rest runs on Night drive.
  await typeHex(page, 'Accent', VIOLET);
  await saveLine(page, 'Saved');
  nightDrive = (await call(aron, 'GET', '/themes')).body?.mine?.find((t) => t.id === nightDrive.id);
  NIGHT_DRIVE_EMBER = css(nightDrive.inputs.accent);

  await cookieTheme(page, (await call(aron, 'GET', '/theme')).body);
  aron.cookie = await freshCookie(page);
  await page.context().close();
  const noJs = await device(aron.cookie, { js: false });
  await noJs.goto(`${APP_URL}/`, { waitUntil: 'domcontentloaded' });
  const e2 = await noJs.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ember').trim());
  check('JS off: the custom theme is in the first document too', e2 === NIGHT_DRIVE_EMBER, e2);
  await noJs.context().close();

  const murky = await call(aron, 'POST', '/themes', { name: 'Murky', base: 'midnight', inputs: MURKY });
  check('the route refuses an unreadable theme with its findings (422)',
    murky.status === 422 && murky.body?.findings?.some((f) => f.pair === 'accent'), JSON.stringify(murky.body));

  // The cap: 20 per person.
  const filler = await member('filler', 'Filler');
  let last = 0;
  for (let i = 0; i < 20; i++) last = (await call(filler, 'POST', '/themes', { name: `T${i}`, base: 'mono', inputs: MIDNIGHT_INPUTS })).status;
  const over = await call(filler, 'POST', '/themes', { name: 'One too many', base: 'mono', inputs: MIDNIGHT_INPUTS });
  check('20 themes fit, the 21st is refused (409)', last === 201 && over.status === 409, `${last} then ${over.status}`);
  const list = await call(filler, 'GET', '/themes');
  check('the list says the cap and holds 20', list.body?.cap === 20 && list.body?.mine?.length === 20);
}

// ── 4. Sharing with a second person ───────────────────────────────────────
{
  const luka = await member('luka', 'Luka');
  const before = await call(luka, 'GET', '/themes');
  check('Luka does not see Aron\'s private theme', !before.body?.shared?.some((t) => t.id === nightDrive.id));
  const direct = await pbDirect(luka, 'GET', `/collections/themes/records/${nightDrive.id}`);
  check('nor straight through /pb (404)', direct.status === 404, String(direct.status));

  const ap = await device(aron.cookie);
  await appearance(ap);
  await tab(ap, 'Share');
  const toggle = ap.getByRole('switch', { name: 'Share with everyone' });
  await toggle.click();
  await ap.waitForFunction(() => document.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'true', null, { timeout: 5000 }).catch(() => {});
  const shared = await call(aron, 'GET', '/themes');
  check('Aron shares it with everyone from the Share tab', shared.body?.mine?.find((t) => t.id === nightDrive.id)?.shared === true);
  check('the Share tab says who sees it', (await ap.getByTestId('share-line').textContent())?.startsWith('Everyone on this Ember server sees Night drive'));

  const after = await call(luka, 'GET', '/themes');
  const seen = after.body?.shared?.find((t) => t.id === nightDrive.id);
  check('Luka sees it in the shared list, by Aron', seen?.ownerName === 'Aron' && seen?.name === 'Night drive', JSON.stringify(seen));
  const viaPb = await pbDirect(luka, 'GET', '/collections/themes/records?perPage=200');
  check('/pb lists it to Luka too (own + shared rule)', viaPb.body?.items?.some((t) => t.id === nightDrive.id));

  check('Luka cannot rename it (403)', (await call(luka, 'PATCH', `/themes/${nightDrive.id}`, { name: 'Mine now' })).status === 403);
  check('Luka cannot delete it (403)', (await call(luka, 'DELETE', `/themes/${nightDrive.id}`)).status === 403);
  const pbWrite = await pbDirect(luka, 'PATCH', `/collections/themes/records/${nightDrive.id}`, { name: 'hack' });
  const pbCreate = await pbDirect(luka, 'POST', '/collections/themes/records', { owner: luka.id, name: 'x', base: 'ember', inputs: MIDNIGHT_INPUTS });
  check('/pb refuses writes from anyone (only the routes write)', pbWrite.status === 403 && pbCreate.status === 403, `${pbWrite.status} ${pbCreate.status}`);

  const lp = await device(luka.cookie);
  await appearance(lp);
  const row = lp.getByTestId('shared-theme').filter({ hasText: 'Night drive' });
  check('Luka\'s Appearance lists it by Aron', (await row.getByText('by Aron').count()) === 1);
  await row.getByRole('button', { name: 'Use Night drive' }).click();
  await saveLine(lp, 'Saved');
  const lukaUses = await call(luka, 'GET', '/theme');
  check('Luka uses it from the page', lukaUses.body?.themeId === nightDrive.id, JSON.stringify(lukaUses.body));
  const lukaEmber = await rootVar(lp, '--ember');
  check('Luka\'s page paints Aron\'s theme', lukaEmber === NIGHT_DRIVE_EMBER, lukaEmber);
  await tab(lp, 'Colours');
  check('and sees it read-only', (await lp.getByTestId('read-only-note').textContent())?.includes('Only Aron can change it'));
  await tab(lp, 'Share');
  check('with sharing not his to change', await lp.getByRole('switch', { name: 'Share with everyone' }).isDisabled());
  await tab(lp, 'Themes');

  await lp.getByRole('button', { name: 'Copy Night drive to my themes' }).click();
  await lp.getByTestId('appearance-notice').filter({ hasText: 'Copied to My themes as Night drive copy.' }).waitFor({ timeout: 5000 }).catch(() => {});
  const copied = (await call(luka, 'GET', '/themes')).body?.mine?.find((t) => t.name === 'Night drive copy');
  check('Luka copies it into his own themes from the page', !!copied && copied.shared === false, JSON.stringify(copied));

  await toggle.click();
  await ap.waitForFunction(() => document.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'false', null, { timeout: 5000 }).catch(() => {});
  check('Aron unshares it from the Share tab', (await call(aron, 'GET', '/themes')).body?.mine?.find((t) => t.id === nightDrive.id)?.shared === false);
  await ap.context().close();
  const kept = await call(luka, 'GET', '/theme');
  check('unshared: Luka keeps a copy of its colours', !kept.body?.themeId && JSON.stringify(kept.body?.custom?.accent) === JSON.stringify(nightDrive.inputs.accent), JSON.stringify(kept.body));
  await lp.reload({ waitUntil: 'networkidle' });
  const stillEmber = await lp.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ember').trim());
  check('and his page still looks the same', stillEmber === NIGHT_DRIVE_EMBER, stillEmber);
  check('it is gone from his shared list', !(await call(luka, 'GET', '/themes')).body?.shared?.some((t) => t.id === nightDrive.id));
  await lp.context().close();
}

// ── 5. Back to Ember clears every override ────────────────────────────────
{
  await call(aron, 'PATCH', '/theme', { preset: 'ember' });
  const page = await device(aron.cookie);
  await page.goto(`${APP_URL}/`, { waitUntil: 'networkidle' });
  await cookieTheme(page, { v: 1, preset: 'ember' });
  const p = await paint(page);
  check('Ember again: no inline theme variables', p.inline.length === 0, p.inline.join(','));
  check('Ember again: --background is the globals.css default', sameColour(p.tokens['--background'], TOKENS['--background']), p.tokens['--background']);
  aron.cookie = await freshCookie(page);
  await page.context().close();
  const html = await fetch(`${APP_URL}/`, { headers: { cookie: `pb_auth=${aron.cookie}` } }).then((r) => r.text());
  const htmlTag = /<html[^>]*>/.exec(html)?.[0] ?? '';
  check('Ember again: the server <html> has no style attribute', !/\sstyle=/.test(htmlTag), htmlTag);
}

// ── 6. Signed out is Ember, whatever this device cached ──────────────────
{
  const page = await device(null, {
    init: { fn: ([key]) => localStorage.setItem(key, JSON.stringify({ state: { doc: { v: 1, preset: 'midnight' } }, version: 0 })), arg: [THEME_KEY] },
  });
  await page.goto(`${APP_URL}/auth`, { waitUntil: 'networkidle' });
  const p = await paint(page);
  check('/auth signed out: Ember, no overrides, despite a cached Midnight',
    p.inline.length === 0 && sameColour(p.tokens['--background'], TOKENS['--background']), `${p.tokens['--background']} ${p.inline.join(',')}`);
  check('/auth signed out: theme-color is Ember\'s', JSON.stringify(p.meta) === '["#0c0d0f"]', JSON.stringify(p.meta));
  await page.goto(`${APP_URL}/privacy`, { waitUntil: 'networkidle' });
  const q = await paint(page);
  check('/privacy signed out: Ember', q.inline.length === 0 && sameColour(q.tokens['--background'], TOKENS['--background']));
  await page.context().close();
}

// ── 7. Every preset on Home, Appearance, Help, Plugins; phone and desktop ─
/** Everything painted on the accent, measured in the page: text and icons
 *  on a .bg-ember element against it, and a switch thumb against the
 *  .bg-ember track it sits on. Colours go through a 1px canvas so oklch()
 *  and color-mix() come back as sRGB. Returns the pairs under 3:1. */
function onAccentProblems() {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgb = (c) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  const lum = (c) => {
    const [r, g, b] = rgb(c).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const label = (el) => (el.getAttribute('aria-label') || el.textContent || el.className).trim().slice(0, 40);
  const bad = [];
  for (const el of document.querySelectorAll('.bg-ember')) {
    if (!shown(el)) continue;
    const bg = getComputedStyle(el).backgroundColor;
    if (el.textContent.trim() || el.querySelector('svg')) {
      const r = ratio(getComputedStyle(el).color, bg);
      if (r < 3) bad.push(`text on "${label(el)}" ${r.toFixed(2)}:1`);
    }
    for (const thumb of el.querySelectorAll(':scope > .bg-ember-foreground')) {
      const r = ratio(getComputedStyle(thumb).backgroundColor, bg);
      if (r < 3) bad.push(`thumb on "${label(el)}" ${r.toFixed(2)}:1`);
    }
  }
  return bad;
}

{
  const who = await member('shots', 'Shots');
  const page = await device(who.cookie);
  if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });
  const overflow = [];
  const onAccent = [];
  let accentChecked = 0;
  for (const preset of PRESETS) {
    await page.setViewportSize({ width: 1300, height: 900 });
    await appearance(page);
    await page.getByRole('radio', { name: new RegExp(`^${preset}`, 'i') }).click();
    await saveLine(page, 'Saved');
    for (const width of [1300, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      for (const [name, route] of [
        ['home', '/'],
        ['appearance', '/settings/appearance'],
        ['help', '/settings/help'],
        ['plugins', '/settings/plugins'],
      ]) {
        await page.goto(`${APP_URL}${route}`, { waitUntil: 'networkidle' });
        if (name === 'appearance') await page.getByTestId('theme-count').waitFor({ timeout: 10000 });
        const wide = await page.evaluate(() => {
          const el = document.querySelector('[data-app-scroller]');
          return el ? el.scrollWidth - el.clientWidth : 0;
        });
        if (wide > 1) overflow.push(`${preset}-${name}-${width}: ${wide}px`);
        if (name === 'help') await page.getByRole('button', { name: 'Report a bug' }).waitFor({ timeout: 10000 });
        accentChecked += await page.locator('.bg-ember').count();
        for (const p of await page.evaluate(onAccentProblems)) onAccent.push(`${preset}-${name}-${width}: ${p}`);
        if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `${preset}-${name}-${width}.png`) });
      }
    }
  }
  // The check itself can see the bug it is for: on Mono (the last preset
  // picked), the old play button's text-white on bg-ember is caught.
  await page.evaluate(() => {
    const el = document.createElement('button');
    el.id = 'planted';
    el.className = 'bg-ember text-white';
    el.textContent = 'Planted';
    document.body.append(el);
  });
  const planted = await page.evaluate(onAccentProblems);
  await page.evaluate(() => document.getElementById('planted')?.remove());
  check('the accent check catches text-white on Mono\'s white accent', planted.some((p) => p.includes('Planted')), JSON.stringify(planted));
  const bg = await rootVar(page, '--background');
  check('every preset renders Home, Appearance, Help and Plugins at 390 and 1300 with no sideways scroll', overflow.length === 0, overflow.join(', '));
  check(`text, icons and thumbs on the accent read at 3:1 or better in every preset (${accentChecked} accent surfaces)`, accentChecked > 0 && onAccent.length === 0, onAccent.join('; '));
  check('the last preset picked (Mono) is on the page', bg === 'oklch(0 0 0)', bg);
  if (SHOT_DIR) console.log(`screenshots in ${SHOT_DIR}`);
  await page.context().close();
}

await browser.close();

const failed = checks.filter(([, p]) => !p);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map(([n]) => n).join(', '));
process.exit(failed.length ? 1 : 0);
