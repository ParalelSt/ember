/** Copy songs between playlists (web 0.7.3), in a real browser.
 *
 *      PB_URL=http://127.0.0.1:8087 APP_URL=http://127.0.0.1:3052 \
 *        node tests/playlist-copy-ui.test.mjs        # or: npm run test:playlist-copy-ui
 *
 *  At 390x844 and 1280x800, each with a fresh member seeded through the
 *  app's own API: "Road trip" (6 songs) and "Gym" (4), sharing one song by
 *  id, one as another upload ("Harbor Lights (Official Video)" by
 *  "Coastline - Topic"), and a same-title pair by different artists
 *  ("Home" by Edward Sharpe and by Phillip Phillips). Two songs are liked
 *  already (Slow Static and the Harbor Lights video).
 *
 *  Sort: every key both ways reorders the rows, and the choice is still
 *  there after a reload. Select: one by one (tick box and row), Select all,
 *  Clear. Copy all of Road trip into Gym: the picker says "2 already there,
 *  4 to add", the result "Added 4, skipped 2 already there", Which? names
 *  the video, and Gym holds 8 songs with no duplicate, both "Home"s in it.
 *  Copy into Liked songs: the warning ("likes every one of them", "2 are
 *  already liked, so 4 songs get a new like", "Like 4 songs"), Cancel likes
 *  nothing, confirming likes 4 (6 likes, the 4 on top in list order, the
 *  Harbor Lights video not doubled), and Gym's "Home" by Phillip Phillips
 *  copied into Liked songs is liked too (both "Home"s). A new playlist,
 *  named inline, gets 2 songs. The bar stays inside the page scroller (so
 *  above the player bar and the phone nav) and nothing scrolls sideways.
 *
 *  SHOT_DIR saves select mode, the Liked warning and the result at each
 *  width (deviceScaleFactor 1).
 *
 *  Needs a sandbox (PocketBase at PB_URL with this tree's migrations and
 *  hooks, the app built from this tree at APP_URL), the superuser from
 *  EMBER_PB_SUPERUSER_* (main's hardcoded one by default), and
 *  playwright-core with a Chromium (CHROME_PATH, or the Playwright cache). */
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

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8087';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3052';
const SHOT_DIR = process.env.SHOT_DIR;
const PASSWORD = 'PlaylistCopy2026!';

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
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
    const res = await fetch(`${PB_URL}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        identity: process.env.EMBER_PB_SUPERUSER_EMAIL ?? 'admin@ember.com',
        password: process.env.EMBER_PB_SUPERUSER_PASSWORD ?? 'egKa5WNMx3QpuG7',
      }),
    });
    if (res.ok) return (await res.json()).token;
  }
  throw new Error('could not authenticate as PB admin');
}

/** A fresh member, signed in: the pb_auth cookie value. */
async function memberCookie(tag) {
  const token = await adminToken();
  const email = `playlist-copy-${tag}-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
  const made = await fetch(`${PB_URL}/api/collections/users/records`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: token },
    body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name: 'Copy', verified: true }),
  });
  if (!made.ok) throw new Error(`could not create the member: ${made.status} ${await made.text()}`);
  const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: email, password: PASSWORD }),
  }).then((r) => r.json());
  return encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));
}

/** The app's API as that member. */
function apiAs(cookie) {
  return async (method, p, body) => {
    const res = await fetch(`${APP_URL}/api${p}`, {
      method,
      headers: { 'content-type': 'application/json', cookie: `pb_auth=${cookie}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${JSON.stringify(json)}`);
    return json;
  };
}

const art = (hex) =>
  'data:image/svg+xml,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#${hex}"/></svg>`);

let n = 0;
function song(key, title, artist, durationSec, hex) {
  n += 1;
  const sourceId = `pc${key}`.padEnd(11, '0').slice(0, 11);
  return {
    id: `youtube:${sourceId}`,
    source: 'youtube',
    sourceId,
    title,
    artist,
    artistId: null,
    album: `Album ${n}`,
    albumId: null,
    durationSec,
    artworkUrl: art(hex),
    streamUrl: '',
  };
}

const SLOW = song('slow', 'Slow Static', 'Aftertone', 214, '6b8fa3');
const HARBOR = song('harbor', 'Harbor Lights', 'Coastline', 187, 'a36b8f');
const HOME_A = song('homea', 'Home', 'Edward Sharpe', 301, '8fa36b');
const NORTH = song('north', 'Northbound', 'The Nulls', 242, 'a38f6b');
const NIGHT = song('night', 'Night Swim', 'Pale Harbor', 158, '6ba38f');
const ALPHA = song('alpha', 'Alpha Wave', 'Zed Lines', 199, '8f6ba3');
const HARBOR_VIDEO = song('harborv', 'Harbor Lights (Official Video)', 'Coastline - Topic', 190, 'a3a36b');
const HOME_B = song('homeb', 'Home', 'Phillip Phillips', 210, '6b6ba3');
const OTHER = song('other', 'Gym Anthem', 'Iron Tone', 175, 'a36b6b');

const ROAD = [SLOW, HARBOR, HOME_A, NORTH, NIGHT, ALPHA];
const GYM = [SLOW, HARBOR_VIDEO, HOME_B, OTHER];

async function seed(cookie) {
  const api = apiAs(cookie);
  // Gym first, so Road trip is the newer one (the sidebar lists newest first).
  const gym = (await api('POST', '/playlists', { name: 'Gym' })).playlist;
  for (const t of GYM) await api('POST', `/playlists/${gym.id}/tracks`, { track: t });
  const road = (await api('POST', '/playlists', { name: 'Road trip' })).playlist;
  for (const t of ROAD) await api('POST', `/playlists/${road.id}/tracks`, { track: t });
  await api('POST', '/likes', { track: SLOW });
  await api('POST', '/likes', { track: HARBOR_VIDEO });
  return { api, road: road.id, gym: gym.id };
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
function expectedOrder(key, dir) {
  const idx = new Map(ROAD.map((t, i) => [t.id, i]));
  const cmp = {
    title: (a, b) => collator.compare(a.title, b.title),
    artist: (a, b) => collator.compare(a.artist, b.artist) || collator.compare(a.title, b.title),
    duration: (a, b) => a.durationSec - b.durationSec,
    // Added one after another, so date added is the list's own order.
    added: (a, b) => idx.get(a.id) - idx.get(b.id),
  }[key];
  const sign = dir === 'asc' ? 1 : -1;
  return [...ROAD].sort((a, b) => sign * cmp(a, b) || idx.get(a.id) - idx.get(b.id)).map((t) => t.title);
}

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });

async function openPage(cookie, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: 'pb_auth', value: cookie, url: APP_URL }]);
  // A song in the player, so the player bar is on screen for the clearance
  // check (it has no audio: the toast is hidden below).
  await ctx.addInitScript((t) => {
    try {
      if (!localStorage.getItem('ember.player.v1')) {
        localStorage.setItem(
          'ember.player.v1',
          JSON.stringify({ state: { queue: [t], index: 0, position: 3, volume: 0.25, context: null, loopMode: 'off', baseCount: 0, muted: false }, version: 0 }),
        );
      }
    } catch {}
  }, OTHER);
  const page = await ctx.newPage();
  return { ctx, page };
}

async function goto(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: '[data-sonner-toaster] { display: none !important; }' });
  await page.getByTestId('track-row').first().waitFor({ timeout: 20000 });
}

const titles = (page) => page.getByTestId('track-row-title').allTextContents();

async function sortBy(page, label) {
  await page.getByTestId('sort-button').click();
  await page.getByTestId('sort-menu').getByRole('button', { name: label, exact: true }).click();
  await page.waitForTimeout(150);
}

async function layout(page) {
  return page.evaluate(() => {
    const box = (el) => (el ? el.getBoundingClientRect().toJSON() : null);
    const scroller = document.querySelector('[data-app-scroller]');
    return {
      docOverflow: document.documentElement.scrollWidth - window.innerWidth,
      scrollerOverflow: scroller.scrollWidth - scroller.clientWidth,
      scroller: box(scroller),
      bar: box(document.querySelector('[data-testid="copy-bar"]')),
      player: box(document.querySelector('footer[data-testid="player-bar"]')),
      nav: box(document.querySelector('[data-testid="mobile-nav"]')),
    };
  });
}

async function checkLayout(page, size, what) {
  const m = await layout(page);
  check(`${size} ${what}: nothing scrolls sideways`, m.docOverflow <= 0 && m.scrollerOverflow <= 0, `page ${m.docOverflow}, scroller ${m.scrollerOverflow}`);
  if (m.bar) {
    const clear =
      m.bar.bottom <= m.scroller.bottom + 0.5 &&
      (!m.player || m.bar.bottom <= m.player.top + 0.5) &&
      (!m.nav || m.nav.height === 0 || m.bar.bottom <= m.nav.top + 0.5);
    check(
      `${size} ${what}: the bar sits inside the scroller, above the player bar${m.nav?.height ? ' and the phone nav' : ''}`,
      clear && m.bar.left >= -0.5 && m.bar.right <= m.scroller.right + 0.5,
      `bar ${Math.round(m.bar.top)}..${Math.round(m.bar.bottom)}, scroller bottom ${Math.round(m.scroller.bottom)}, player top ${Math.round(m.player?.top ?? -1)}`,
    );
  }
}

const shot = async (page, name) => {
  if (!SHOT_DIR) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, name) });
};

async function run(width, height) {
  const size = `${width}`;
  const cookie = await memberCookie(size);
  const { api, road, gym } = await seed(cookie);
  const { ctx, page } = await openPage(cookie, width, height);
  try {
    await goto(page, `${APP_URL}/playlist/${road}`);
    check(`${size}: Road trip shows its 6 songs in order`, JSON.stringify(await titles(page)) === JSON.stringify(ROAD.map((t) => t.title)));

    // Sort, outside select mode: every key both ways.
    for (const [key, label, asc, desc] of [
      ['title', 'Title', 'A to Z', 'Z to A'],
      ['artist', 'Artist', 'A to Z', 'Z to A'],
      ['duration', 'Duration', 'Shortest first', 'Longest first'],
      ['added', 'Date added', 'Newest first', 'Oldest first'],
    ]) {
      for (const [dirLabel, dir] of key === 'added' ? [[asc, 'desc'], [desc, 'asc']] : [[asc, 'asc'], [desc, 'desc']]) {
        await sortBy(page, `${label}, ${dirLabel}`);
        const got = await titles(page);
        const want = expectedOrder(key, dir);
        check(`${size}: sort ${label}, ${dirLabel}`, JSON.stringify(got) === JSON.stringify(want), got.join(' / '));
      }
    }
    await sortBy(page, 'Title, Z to A');
    await goto(page, `${APP_URL}/playlist/${road}`);
    check(`${size}: the sort is remembered for this playlist after a reload`, JSON.stringify(await titles(page)) === JSON.stringify(expectedOrder('title', 'desc')));
    await goto(page, `${APP_URL}/playlist/${gym}`);
    check(`${size}: another playlist keeps its own order`, JSON.stringify(await titles(page)) === JSON.stringify(GYM.map((t) => t.title)));
    await goto(page, `${APP_URL}/playlist/${road}`);
    await sortBy(page, 'Date added, Oldest first');

    // Select one by one, Select all, Clear.
    await page.getByTestId('select-toggle').click();
    check(`${size}: Select turns the play column into tick boxes`, (await page.getByRole('checkbox', { name: /^Select (?!all$)/ }).count()) === 6);
    await page.getByRole('checkbox', { name: 'Select Harbor Lights' }).click();
    await page.getByTestId('track-row').filter({ hasText: 'Northbound' }).click();
    await page.getByTestId('track-row').filter({ hasText: 'Night Swim' }).click();
    check(`${size}: picked one by one, by tick box and by row`, (await page.getByTestId('copy-count').textContent()) === '3 selected');
    check(`${size}: the row above the list counts them`, (await page.getByTestId('select-count').textContent()) === '3 of 6');
    await page.waitForTimeout(200);
    await checkLayout(page, size, 'select mode');
    await shot(page, `select-${size}.png`);
    // At the top of the page the bar is stuck to the bottom of the
    // scroller (the list runs past it), where Back to top floats too.
    const lift = await page.evaluate(async () => {
      const b = document.querySelector('[data-back-to-top]').getBoundingClientRect();
      const bar = document.querySelector('[data-testid="copy-bar"]').getBoundingClientRect();
      const overlap = !(b.bottom <= bar.top || b.top >= bar.bottom || b.right <= bar.left || b.left >= bar.right);
      return { overlap, back: [Math.round(b.top), Math.round(b.bottom)], bar: [Math.round(bar.top), Math.round(bar.bottom)] };
    });
    check(`${size}: Back to top never covers the bar`, !lift.overlap, JSON.stringify(lift));
    await page.getByTestId('select-all').click();
    check(`${size}: Select all picks all 6`, (await page.getByTestId('copy-count').textContent()) === '6 selected');
    await page.getByTestId('select-all').click();
    check(`${size}: the same control clears them`, (await page.getByTestId('copy-count').textContent()) === 'Pick songs to copy');
    await page.getByTestId('select-all').click();

    // Copy all of Road trip into Gym.
    await page.getByTestId('copy-to').click();
    const gymRow = page.locator(`[data-testid="copy-destination"][data-destination="${gym}"]`);
    await gymRow.getByText('2 already there, 4 to add').waitFor({ timeout: 10000 });
    const order = await page.getByTestId('copy-destination').evaluateAll((els) => els.map((e) => e.getAttribute('data-destination')));
    check(`${size}: the picker lists New playlist, Liked songs, then the other playlists`, JSON.stringify(order) === JSON.stringify(['new', 'liked', gym]), order.join(', '));
    const likedNote = await page.locator('[data-testid="copy-destination"][data-destination="liked"] [data-testid="copy-destination-note"]').textContent();
    check(`${size}: Liked songs says 2 already liked`, likedNote === '2 already liked, 4 to add', likedNote);
    await checkLayout(page, size, 'picker open');
    await page.waitForTimeout(300);
    await shot(page, `picker-${size}.png`);
    await gymRow.click();
    await page.getByTestId('copy-result-line').waitFor({ timeout: 15000 });
    const line = await page.getByTestId('copy-result-line').textContent();
    check(`${size}: the result reads "Added 4, skipped 2 already there"`, line === 'Added 4, skipped 2 already there', line);
    await page.getByTestId('copy-which').click();
    const skipped = await page.getByTestId('copy-skipped').textContent();
    check(
      `${size}: Which? names the song and the other version already there`,
      skipped.includes('Slow Static · Aftertone: already there') && skipped.includes('Harbor Lights · Coastline: already there as "Harbor Lights (Official Video)"'),
      skipped,
    );
    check(`${size}: select mode is over`, (await page.getByRole('checkbox').count()) === 0);
    await checkLayout(page, size, 'result');
    await page.waitForTimeout(400);
    await shot(page, `result-${size}.png`);
    const gymNow = (await api('GET', `/playlists/${gym}`)).tracks;
    const ids = gymNow.map((t) => t.id);
    check(`${size}: Gym holds 8 songs, none twice`, ids.length === 8 && new Set(ids).size === 8, gymNow.map((t) => `${t.title} (${t.artist})`).join(' / '));
    check(
      `${size}: both "Home"s are in Gym, Harbor Lights only as the video`,
      ids.includes(HOME_A.id) && ids.includes(HOME_B.id) && !ids.includes(HARBOR.id) && ids.includes(HARBOR_VIDEO.id),
    );
    check(`${size}: the copies landed after Gym's own songs, in order`, JSON.stringify(ids.slice(4)) === JSON.stringify([HOME_A, NORTH, NIGHT, ALPHA].map((t) => t.id)));
    await page.getByTestId('copy-done').click();

    // Copy into Liked songs: the warning, Cancel, then yes.
    await page.getByTestId('select-toggle').click();
    await page.getByTestId('select-all').click();
    await page.getByTestId('copy-to').click();
    await page.locator('[data-testid="copy-destination"][data-destination="liked"]').click();
    const warning = page.getByTestId('copy-liked-confirm');
    await warning.waitFor({ timeout: 10000 });
    const text = await warning.textContent();
    check(`${size}: the warning says it likes every one of them`, text.includes('Adding songs to Liked songs likes every one of them'), text);
    check(`${size}: the warning counts the ones already liked`, text.includes('2 are already liked, so 4 songs get a new like.'), text);
    check(`${size}: the button reads "Like 4 songs"`, (await page.getByTestId('copy-liked-yes').textContent()).trim() === 'Like 4 songs');
    await page.waitForTimeout(300);
    await shot(page, `liked-warning-${size}.png`);
    await warning.getByRole('button', { name: 'Cancel' }).click();
    await warning.waitFor({ state: 'detached', timeout: 5000 });
    check(`${size}: Cancel likes nothing`, (await api('GET', '/likes')).tracks.length === 2);
    await page.getByTestId('copy-to').click();
    await page.locator('[data-testid="copy-destination"][data-destination="liked"]').click();
    await page.getByTestId('copy-liked-yes').click();
    await page.getByTestId('copy-result-line').waitFor({ timeout: 15000 });
    const likedLine = await page.getByTestId('copy-result-line').textContent();
    check(`${size}: Liked result "Added 4, skipped 2 already there"`, likedLine === 'Added 4, skipped 2 already there', likedLine);
    const likes = (await api('GET', '/likes')).tracks;
    const likeIds = likes.map((t) => t.id);
    check(`${size}: 6 likes now, none twice`, likeIds.length === 6 && new Set(likeIds).size === 6, likes.map((t) => t.title).join(' / '));
    check(`${size}: the 4 new likes are on top, in list order`, JSON.stringify(likeIds.slice(0, 4)) === JSON.stringify([HOME_A, NORTH, NIGHT, ALPHA].map((t) => t.id)));
    check(`${size}: Harbor Lights is not liked twice (its video already was)`, !likeIds.includes(HARBOR.id) && likeIds.includes(HARBOR_VIDEO.id));
    await page.waitForTimeout(500);
    const hearts = await page.getByTestId('track-row').evaluateAll((rows) =>
      rows.map((r) => [r.querySelector('[data-testid="track-row-title"]')?.textContent, r.querySelector('button[aria-pressed]')?.getAttribute('aria-pressed')]),
    );
    check(`${size}: every Road trip heart is on`, hearts.every(([, on]) => on === 'true'), JSON.stringify(hearts));
    await page.getByTestId('copy-done').click();

    // Gym's "Home" (Phillip Phillips) into Liked songs: a different song, liked too.
    await goto(page, `${APP_URL}/playlist/${gym}`);
    await page.getByTestId('select-toggle').click();
    await page.getByTestId('track-row').filter({ hasText: 'Phillip Phillips' }).click();
    await page.getByTestId('copy-to').click();
    const likedNote2 = await page.locator('[data-testid="copy-destination"][data-destination="liked"] [data-testid="copy-destination-note"]').textContent();
    check(`${size}: the other "Home" is not counted as liked`, likedNote2 === '0 already liked, 1 to add', likedNote2);
    await page.locator('[data-testid="copy-destination"][data-destination="liked"]').click();
    await page.getByTestId('copy-liked-yes').click();
    await page.getByTestId('copy-result-line').waitFor({ timeout: 15000 });
    const both = (await api('GET', '/likes')).tracks.map((t) => t.id);
    check(`${size}: both "Home"s are liked`, both.includes(HOME_A.id) && both.includes(HOME_B.id) && both.length === 7);
    await page.getByTestId('copy-done').click();

    // A new playlist, named inline.
    await page.getByTestId('select-toggle').click();
    await page.getByTestId('track-row').filter({ hasText: 'Gym Anthem' }).click();
    await page.getByTestId('track-row').filter({ hasText: 'Northbound' }).click();
    await page.getByTestId('copy-to').click();
    await page.locator('[data-testid="copy-destination"][data-destination="new"]').click();
    await page.getByLabel('New playlist name').fill(`Fresh mix ${size}`);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByTestId('copy-result-line').waitFor({ timeout: 15000 });
    check(`${size}: a new playlist gets its 2 songs`, (await page.getByTestId('copy-result-line').textContent()) === 'Added 2');
    await page.getByTestId('copy-open').click();
    await page.waitForURL((u) => u.pathname.startsWith('/playlist/') && !u.pathname.endsWith(gym), { timeout: 10000 });
    await page.getByRole('heading', { name: `Fresh mix ${size}` }).waitFor({ timeout: 20000 });
    await page.getByTestId('track-row').first().waitFor({ timeout: 20000 });
    const fresh = await titles(page);
    // Gym's list order: Gym Anthem (4th) before Northbound (6th).
    check(`${size}: Open goes to it, with the songs in list order`, JSON.stringify(fresh) === JSON.stringify(['Gym Anthem', 'Northbound']), fresh.join(' / '));

    // The Liked songs page has the same controls, sorted newest first.
    await goto(page, `${APP_URL}/library/liked`);
    const likedTitles = await titles(page);
    check(`${size}: Liked songs lists newest first`, likedTitles[0] === 'Home' && likedTitles.length === 7, likedTitles.join(' / '));
    await page.getByTestId('select-toggle').click();
    await page.getByTestId('select-all').click();
    await page.getByTestId('copy-to').click();
    const likedDest = await page.getByTestId('copy-destination').evaluateAll((els) => els.map((e) => e.getAttribute('data-destination')));
    check(`${size}: from Liked songs, Liked songs is not a destination`, !likedDest.includes('liked') && likedDest.includes(gym) && likedDest.includes(road), likedDest.join(', '));
    await page.keyboard.press('Escape');
    await checkLayout(page, size, 'Liked songs, select mode');
  } finally {
    await ctx.close();
  }
}

try {
  await run(390, 844);
  await run(1280, 800);
} catch (e) {
  check('the run finished', false, e.stack ?? String(e));
} finally {
  await browser.close();
}

const failed = checks.filter(([, ok]) => !ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
