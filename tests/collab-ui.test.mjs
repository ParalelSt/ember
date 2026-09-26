/** Collaborative playlists in a real browser: the owner at 1280x800, a
 *  member at 390x844, an outsider who arrives through the invite link.
 *
 *      PB_URL=http://127.0.0.1:8198 APP_URL=http://127.0.0.1:3170 \
 *      EMBER_PB_SUPERUSER_EMAIL=... EMBER_PB_SUPERUSER_PASSWORD=... \
 *        node tests/collab-ui.test.mjs        # or: npm run test:collab-ui
 *
 *  The owner opens the playlist menu, Collaborate, turns it on, finds the
 *  member by name in the picker and adds them, and makes an invite link.
 *  The member sees the playlist in their library (people mark, "Shared by
 *  <owner>"), opens it (eyebrow "Collaborative playlist", "By <owner>",
 *  who added each song, no cover button, a menu with only "Who can edit"
 *  and "Leave playlist"), moves the last song up from the row's + menu (a
 *  phone row has no More button), and the owner's open page follows within
 *  the poll; the owner moves it back down from the desktop More menu. The outsider opens the invite link and lands on
 *  the playlist. The member leaves and it is gone from their library.
 *  Nothing scrolls sideways at 390. SHOT_DIR keeps screenshots.
 *
 *  Needs the sandbox of collab-rbac.test.mjs and playwright-core with a
 *  Chromium (CHROME_PATH, or the Playwright cache). */
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

const PB = process.env.PB_URL ?? 'http://127.0.0.1:8198';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:3170';
const SHOT_DIR = process.env.SHOT_DIR;
const SU_EMAIL = process.env.EMBER_PB_SUPERUSER_EMAIL;
const SU_PASSWORD = process.env.EMBER_PB_SUPERUSER_PASSWORD;
if (!SU_EMAIL || !SU_PASSWORD) {
  console.error('Set EMBER_PB_SUPERUSER_EMAIL and EMBER_PB_SUPERUSER_PASSWORD (the throwaway sandbox superuser).');
  process.exit(2);
}
const PW = 'CollabUi2026!';

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = path.join(process.env.HOME ?? '', 'Library/Caches/ms-playwright');
  for (const d of fs.readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const found = execSync(
      `find "${path.join(root, d)}" -maxdepth 6 -type f \\( -name "Google Chrome for Testing" -o -name "Chromium" \\) 2>/dev/null | head -1`,
      { encoding: 'utf8' },
    ).trim();
    if (found) return found;
  }
  throw new Error('no Chromium binary found, set CHROME_PATH');
}

const su = await fetch(`${PB}/api/admins/auth-with-password`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identity: SU_EMAIL, password: SU_PASSWORD }),
}).then((r) => r.json()).then((j) => j.token);
if (!su) throw new Error('superuser sign-in failed');

const stamp = Date.now().toString(36);
async function person(first) {
  const email = `${first.toLowerCase()}-${stamp}@ember.test`;
  const name = `${first} ${stamp.slice(-4)}`;
  const made = await fetch(`${PB}/api/collections/users/records`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: su },
    body: JSON.stringify({ email, password: PW, passwordConfirm: PW, name, verified: true }),
  }).then((r) => r.json());
  const auth = await fetch(`${PB}/api/collections/users/auth-with-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: email, password: PW }),
  }).then((r) => r.json());
  const cookie = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));
  const api = async (method, p, body) => {
    const res = await fetch(`${APP}/api${p}`, {
      method,
      headers: { 'content-type': 'application/json', cookie: `pb_auth=${cookie}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${JSON.stringify(json)}`);
    return json;
  };
  return { id: made.id, name, cookie, api };
}

const art = (hex) =>
  'data:image/svg+xml,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#${hex}"/></svg>`);
const song = (key, title, hex) => ({
  id: `youtube:${`cu${key}`.padEnd(11, '0').slice(0, 11)}`,
  source: 'youtube',
  sourceId: `cu${key}`.padEnd(11, '0').slice(0, 11),
  title,
  artist: 'The Nulls',
  artistId: null,
  album: null,
  albumId: null,
  durationSec: 200,
  artworkUrl: art(hex),
  streamUrl: '',
});
const SONGS = [song('one', 'First Light', '6b8fa3'), song('two', 'Second Wind', 'a36b8f'), song('three', 'Third Rail', '8fa36b')];

const owner = await person('Olga');
const member = await person('Mia');
const outsider = await person('Xan');
const pid = (await owner.api('POST', '/playlists', { name: `Road trip ${stamp.slice(-4)}` })).playlist.id;
for (const t of SONGS.slice(0, 2)) await owner.api('POST', `/playlists/${pid}/tracks`, { track: t });

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
async function open(who, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: 'pb_auth', value: who.cookie, url: APP }]);
  const page = await ctx.newPage();
  return { ctx, page };
}
async function go(page, url, waitFor) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: '[data-sonner-toaster] { display: none !important; }' });
  if (waitFor) await waitFor.waitFor({ timeout: 20000 });
}
const shot = async (page, name) => {
  if (!SHOT_DIR) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, name) });
};
const titles = (page) => page.getByTestId('track-row-title').allTextContents();

try {
  // ── The owner shares it ────────────────────────────────────────────────
  const o = await open(owner, 1280, 800);
  await go(o.page, `${APP}/playlist/${pid}`, o.page.getByTestId('track-row').first());
  await o.page.getByTestId('playlist-menu').click();
  await o.page.getByTestId('menu-collaborate').waitFor();
  const items = await o.page.getByRole('menuitem').allTextContents();
  check('owner: the menu has Collaborate, Rename and Delete', items.map((s) => s.trim()).join('|') === 'Collaborate|Rename|Delete playlist', items.join('|'));
  await o.page.getByTestId('menu-collaborate').click();
  const sheet = o.page.getByTestId('collab-sheet');
  await sheet.getByTestId('collab-switch').waitFor();
  check('owner: the sheet opens with collaboration off', (await sheet.getByTestId('collab-switch').getAttribute('aria-checked')) === 'false');
  await sheet.getByTestId('collab-switch').click();
  await sheet.getByTestId('collab-people').waitFor();
  check('owner: switched on, the people and link sections appear', await sheet.getByTestId('collab-link').isVisible());
  await sheet.getByTestId('collab-add').click();
  await sheet.getByRole('textbox', { name: 'Find someone by name' }).fill('Mia');
  const candidate = sheet.getByTestId('collab-candidate').filter({ hasText: member.name });
  await candidate.waitFor();
  check('owner: the picker finds the member by name, no email shown', !(await sheet.getByTestId('collab-picker').textContent()).includes('@'));
  await candidate.getByRole('button', { name: `Add ${member.name}` }).click();
  await sheet.getByTestId('collab-person').filter({ hasText: member.name }).waitFor();
  check('owner: the member is on the list', true);
  await sheet.getByTestId('collab-link-create').click();
  const url = await sheet.getByTestId('collab-link-url').inputValue({ timeout: 10000 });
  check('owner: an invite link on this server', url.startsWith(`${APP}/playlist/join/`) && url.length === `${APP}/playlist/join/`.length + 32, url);
  await shot(o.page, 'collab-owner-sheet-1280.png');
  await o.page.keyboard.press('Escape');
  await o.page.getByText('Collaborative playlist').first().waitFor();
  check('owner: the header says Collaborative playlist', true);
  check('owner: each row says who added it', (await o.page.getByTestId('track-row-added-by').count()) === 2);

  // ── The member finds it and edits ──────────────────────────────────────
  const m = await open(member, 390, 844);
  await member.api('POST', `/playlists/${pid}/tracks`, { track: SONGS[2] });
  const card = m.page.locator('a', { has: m.page.getByTestId('shared-badge') }).filter({ hasText: `Road trip ${stamp.slice(-4)}` });
  await go(m.page, `${APP}/library`, card);
  check('member: the library card says whose it is', (await card.textContent()).includes(`Shared by ${owner.name}`), await card.textContent());
  check('member: and wears the people mark', (await card.getByTestId('shared-badge').count()) === 1);
  await go(m.page, `${APP}/playlist/${pid}`, m.page.getByTestId('track-row').first());
  const header = await m.page.locator('main').first().textContent();
  check('member: eyebrow and "By <owner>" in the header', header.includes('Collaborative playlist') && header.includes(`By ${owner.name}`));
  check('member: no cover button', (await m.page.getByRole('button', { name: 'Change playlist cover' }).count()) === 0);
  const by = await m.page.getByTestId('track-row-added-by').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  check('member: who added each song', JSON.stringify(by) === JSON.stringify([`Added by ${owner.name}`, `Added by ${owner.name}`, `Added by ${member.name}`]), by.join(', '));
  await m.page.getByTestId('playlist-menu').click();
  await m.page.getByTestId('menu-leave').waitFor();
  const mItems = (await m.page.getByRole('menuitem').allTextContents()).map((s) => s.trim());
  check('member: the menu has only Who can edit and Leave', mItems.join('|') === 'Who can edit|Leave playlist', mItems.join('|'));
  await m.page.keyboard.press('Escape');
  // A phone row has no room for a More button: Move up sits in its + menu.
  check('member at 390: no More button on the rows', (await m.page.getByTestId('track-row').nth(2).getByRole('button', { name: 'More' }).isVisible()) === false);
  await m.page.getByTestId('track-row').nth(2).getByRole('button', { name: 'Add to playlist' }).click();
  await m.page.getByRole('menuitem', { name: /Move up/ }).click();
  await m.page.waitForFunction(() => document.querySelectorAll('[data-testid="track-row-title"]')[1]?.textContent === 'Third Rail');
  check('member: Move up moves the song', JSON.stringify(await titles(m.page)) === JSON.stringify(['First Light', 'Third Rail', 'Second Wind']));
  const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('member at 390: nothing scrolls sideways', overflow <= 0, `${overflow}px`);
  await shot(m.page, 'collab-member-390.png');

  // The owner's open page follows (the collaborative poll).
  await o.page.waitForFunction(
    () => [...document.querySelectorAll('[data-testid="track-row-title"]')].map((e) => e.textContent).join('|') === 'First Light|Third Rail|Second Wind',
    undefined,
    { timeout: 15000 },
  ).then(() => check('owner: the open page shows the member\'s add and move within the poll', true),
    () => check('owner: the open page shows the member\'s add and move within the poll', false));

  // The owner moves one back down from the desktop row's More menu.
  await o.page.getByTestId('track-row').nth(1).getByRole('button', { name: 'More' }).click();
  await o.page.getByRole('menuitem', { name: /Move down/ }).click();
  await o.page.waitForFunction(() => document.querySelectorAll('[data-testid="track-row-title"]')[2]?.textContent === 'Third Rail');
  const serverOrder = (await owner.api('GET', `/playlists/${pid}`)).tracks.map((t) => t.title);
  check('owner at 1280: Move down in the More menu, saved on the server', serverOrder.join('|') === 'First Light|Second Wind|Third Rail', serverOrder.join('|'));

  // ── The outsider comes in through the link ─────────────────────────────
  const x = await open(outsider, 1280, 800);
  await x.page.goto(url, { waitUntil: 'networkidle' });
  await x.page.waitForURL(`**/playlist/${pid}`, { timeout: 15000 }).then(() => {}, () => {});
  check('outsider: the invite link lands on the playlist', x.page.url().endsWith(`/playlist/${pid}`), x.page.url());
  await x.page.getByTestId('track-row').first().waitFor({ timeout: 15000 });
  check('outsider: and can see its songs', (await x.page.getByTestId('track-row').count()) === 3);

  // ── The member leaves ──────────────────────────────────────────────────
  await m.page.getByTestId('playlist-menu').click();
  await m.page.getByTestId('menu-leave').click();
  await m.page.getByRole('button', { name: 'Leave', exact: true }).click();
  await m.page.waitForURL('**/library', { timeout: 15000 }).then(() => {}, () => {});
  await m.page.waitForTimeout(500);
  check('member: after leaving, back on the library without it',
    m.page.url().endsWith('/library') && (await card.count()) === 0, m.page.url());
} finally {
  await browser.close();
  for (const who of [owner, member, outsider]) {
    await fetch(`${PB}/api/collections/users/records/${who.id}`, { method: 'DELETE', headers: { Authorization: su } });
  }
}

const failed = checks.filter(([, pass]) => !pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
