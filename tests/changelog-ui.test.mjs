/** What's new: the New tag in the sidebar, the dot on the phone menu button,
 *  Mark all as read, and the "Don't show New tags" switch, end to end in a
 *  real browser against a sandbox.
 *
 *      node tests/changelog-ui.test.mjs      # or: npm run test:changelog-ui
 *
 *  Needs the sandbox from tests/README.md (PocketBase restarted with this
 *  branch's pb_hooks, so the two changelog user fields exist) and
 *  playwright-core. Set PB_URL / APP_URL for other ports, CHROME_PATH to pick
 *  a browser, SHOTS_DIR to save screenshots of the sidebar, the page and the
 *  phone drawer.
 *
 *  Each run creates a brand new @ember.test user, so the first check (a new
 *  user sees nothing as New) holds on every run. The user is deleted at the
 *  end, along with the invite it needs to get past the sign-in form. */
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

const PB = process.env.PB_URL ?? 'http://127.0.0.1:8091';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:3005';
const SHOTS = process.env.SHOTS_DIR ?? '';
const PASSWORD = 'BugTest2026!';
const ADMIN_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL ?? 'admin@ember.com';
const ADMIN_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD ?? 'egKa5WNMx3QpuG7';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_VERSION = JSON.parse(fs.readFileSync(path.join(root, 'apps/web/package.json'), 'utf8')).version;
const OLD_VERSION = '0.2.4';

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = path.join(process.env.HOME ?? '', 'Library/Caches/ms-playwright');
  if (!fs.existsSync(cache)) throw new Error('no Playwright browser cache, set CHROME_PATH');
  for (const d of fs.readdirSync(cache).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const found = execSync(
      `find "${path.join(cache, d)}" -maxdepth 6 -type f \\( -name "Google Chrome for Testing" -o -name "Chromium" \\) 2>/dev/null | head -1`,
      { encoding: 'utf8' },
    ).trim();
    if (found) return found;
  }
  throw new Error('no Chromium binary found, set CHROME_PATH');
}

async function adminToken() {
  // PocketBase renamed this collection; try both so the suite spans versions.
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const r = await fetch(PB + p, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: ADMIN_EMAIL, password: ADMIN_PASSWORD }) });
    if (r.ok) return (await r.json()).token;
  }
  throw new Error('could not authenticate as PB admin');
}

const token = await adminToken();
const admin = (p, init = {}) => fetch(PB + p, { ...init,
  headers: { 'content-type': 'application/json', Authorization: token, ...(init.headers ?? {}) } });

const email = `changelog-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
const created = await admin('/api/collections/users/records', { method: 'POST',
  body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name: 'Changelog Tester', verified: true }) });
if (!created.ok) throw new Error(`could not create test user: ${created.status} ${await created.text()}`);
const userId = (await created.json()).id;
// The sign-in form only lets invited emails through.
const invited = await admin('/api/collections/allowed_emails/records', { method: 'POST', body: JSON.stringify({ email }) });
if (!invited.ok) throw new Error(`could not invite test user: ${invited.status} ${await invited.text()}`);
const inviteId = (await invited.json()).id;

const readUser = () => admin(`/api/collections/users/records/${userId}`).then((r) => r.json());
const writeUser = (patch) => admin(`/api/collections/users/records/${userId}`, { method: 'PATCH', body: JSON.stringify(patch) });

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const consoleErrors = [];

try {
  // ── A. sign in through the form as a brand new user ─────────────────────
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desk.newPage();
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  await page.goto(`${APP}/auth`, { waitUntil: 'networkidle' });
  await page.fill('#email', email);
  await page.click('button[type="submit"]');
  await page.fill('#password', PASSWORD);
  const firstLoad = page.waitForResponse((r) => r.url().includes('/api/changelog') && r.request().method() === 'PATCH', { timeout: 15000 })
    .catch(() => null);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 15000 });
  check('A1 signed in through the form', !new URL(page.url()).pathname.startsWith('/auth'), page.url());

  const sidebarRow = page.locator('aside [data-testid="whats-new-link"]');
  await sidebarRow.waitFor({ timeout: 10000 });
  const firstPatch = await firstLoad;
  check('A2 first load writes the current version for a new user', firstPatch?.ok() === true,
    firstPatch ? `PATCH ${firstPatch.status()}` : 'no PATCH seen');
  await page.waitForTimeout(500);
  check('A3 a brand new user sees no New tag in the sidebar',
    (await sidebarRow.locator('[data-testid="new-badge"]').count()) === 0);
  const afterFirst = await readUser();
  check('A4 their seen version is now the app version', afterFirst.changelog_seen_version === APP_VERSION,
    `${afterFirst.changelog_seen_version} vs ${APP_VERSION}`);

  // ── B. an older seen version: the pulsing tag appears ───────────────────
  await writeUser({ changelog_seen_version: OLD_VERSION });
  await page.reload({ waitUntil: 'networkidle' });
  const badge = sidebarRow.locator('[data-testid="new-badge"]');
  await badge.waitFor({ timeout: 10000 }).catch(() => {});
  check('B1 the New tag shows in the sidebar row at 1440 wide', await badge.isVisible());
  const anim = await badge.evaluate((el) => getComputedStyle(el).animationName).catch(() => '');
  check('B2 the tag pulses', anim === 'ember-new-pulse', anim);
  const row = await sidebarRow.boundingBox();
  const pill = await badge.boundingBox();
  check('B3 the tag sits at the right edge of the row', !!row && !!pill && row.x + row.width - (pill.x + pill.width) < 20,
    row && pill ? `${Math.round(row.x + row.width - (pill.x + pill.width))}px from the edge` : '');
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.locator('aside').screenshot({ path: path.join(SHOTS, 'sidebar-new-tag.png'), animations: 'disabled' });
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const still = await badge.evaluate((el) => getComputedStyle(el).animationName);
  check('B4 no pulse under prefers-reduced-motion', still === 'none', still);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // ── C. phone: the dot on the menu button and the tag in the drawer ──────
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phone.addCookies(await desk.cookies());
  const pp = await phone.newPage();
  pp.on('pageerror', (e) => consoleErrors.push(String(e)));
  await pp.goto(`${APP}/`, { waitUntil: 'networkidle' });
  const menu = pp.getByRole('button', { name: 'Open menu' });
  const dot = menu.locator('[data-testid="unread-dot"]');
  await dot.waitFor({ timeout: 10000 }).catch(() => {});
  check('C1 the menu button has the dot at 390 wide', await dot.isVisible());
  check('C2 the desktop sidebar is hidden on phone', !(await pp.locator('aside').isVisible()));
  await menu.click();
  const drawerRow = pp.locator('[data-slot="sheet-content"] [data-testid="whats-new-link"], [role="dialog"] [data-testid="whats-new-link"]').first();
  await drawerRow.waitFor({ timeout: 5000 }).catch(() => {});
  check('C3 the drawer has the What\'s new row with the tag',
    (await drawerRow.isVisible()) && (await drawerRow.locator('[data-testid="new-badge"]').count()) === 1);
  if (SHOTS) {
    await pp.waitForTimeout(500);
    await pp.screenshot({ path: path.join(SHOTS, 'phone-drawer.png'), animations: 'disabled' });
  }
  await drawerRow.click();
  await pp.waitForURL((u) => u.pathname === '/whats-new', { timeout: 10000 }).catch(() => {});
  check('C4 the drawer row opens the page', new URL(pp.url()).pathname === '/whats-new', pp.url());
  if (SHOTS) {
    await pp.waitForTimeout(500);
    await pp.screenshot({ path: path.join(SHOTS, 'phone-whats-new-page.png'), animations: 'disabled' });
  }

  // ── D. the page: tags, opening does not clear, Mark all as read ─────────
  await page.goto(`${APP}/whats-new`, { waitUntil: 'networkidle' });
  const entries = page.locator('[data-testid="changelog-entry"]');
  await entries.first().waitFor({ timeout: 10000 });
  const nEntries = await entries.count();
  const pageBadges = page.locator('[data-testid="changelog-page"] [data-testid="new-badge"]');
  await pageBadges.first().waitFor({ timeout: 10000 }).catch(() => {});
  const nNew = await pageBadges.count();
  check('D1 the page tags every entry above the seen version', nEntries > 0 && nNew === nEntries, `${nNew}/${nEntries}`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'whats-new-page.png'), animations: 'disabled' });

  await page.reload({ waitUntil: 'networkidle' });
  await pageBadges.first().waitFor({ timeout: 10000 }).catch(() => {});
  check('D2 opening the page does not mark anything read', (await pageBadges.count()) === nNew
    && (await readUser()).changelog_seen_version === OLD_VERSION);

  await page.getByRole('button', { name: /mark all as read/i }).click();
  await page.waitForTimeout(800);
  check('D3 Mark all as read clears the page tags', (await pageBadges.count()) === 0);
  check('D4 and the sidebar tag', (await sidebarRow.locator('[data-testid="new-badge"]').count()) === 0);
  check('D5 and saves the app version', (await readUser()).changelog_seen_version === APP_VERSION);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  check('D6 still read after a reload', (await pageBadges.count()) === 0
    && (await sidebarRow.locator('[data-testid="new-badge"]').count()) === 0);
  await pp.goto(`${APP}/`, { waitUntil: 'networkidle' });
  await pp.waitForTimeout(1000);
  check('D7 read on one device is read on the other (no dot on phone)', (await dot.count()) === 0);

  // ── E. the hide switch ──────────────────────────────────────────────────
  await writeUser({ changelog_seen_version: OLD_VERSION });
  await page.reload({ waitUntil: 'networkidle' });
  await pageBadges.first().waitFor({ timeout: 10000 }).catch(() => {});
  check('E1 tags are back after the seen version goes back', (await pageBadges.count()) === nEntries);
  const sw = page.getByRole('button', { name: "Don't show New tags" });
  check('E2 the switch starts off', (await sw.getAttribute('aria-pressed')) === 'false');
  await sw.click();
  await page.waitForTimeout(800);
  check('E3 the switch removes the page tags', (await pageBadges.count()) === 0);
  check('E4 and the sidebar tag', (await sidebarRow.locator('[data-testid="new-badge"]').count()) === 0);
  const hidden = await readUser();
  check('E5 it saves hide without marking read', hidden.changelog_hide_new === true
    && hidden.changelog_seen_version === OLD_VERSION, `hide=${hidden.changelog_hide_new} seen=${hidden.changelog_seen_version}`);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  check('E6 still hidden after a reload', (await pageBadges.count()) === 0
    && (await sw.getAttribute('aria-pressed')) === 'true');
  await pp.reload({ waitUntil: 'networkidle' });
  await pp.waitForTimeout(1000);
  check('E7 no dot on phone while hidden', (await dot.count()) === 0);
  await sw.click();
  await pageBadges.first().waitFor({ timeout: 5000 }).catch(() => {});
  check('E8 turning it off brings the tags back', (await pageBadges.count()) === nEntries);

  check('F1 no uncaught page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  await admin(`/api/collections/users/records/${userId}`, { method: 'DELETE' }).catch(() => {});
  await admin(`/api/collections/allowed_emails/records/${inviteId}`, { method: 'DELETE' }).catch(() => {});
}

const failed = checks.filter(([, p]) => !p);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map(([n]) => n).join(', '));
process.exit(failed.length ? 1 : 0);
