/** Search opens instantly on a slow connection.
 *
 *      node tests/instant-search-ui.test.mjs      # or: npm run test:search-ui
 *
 *  Reported as: tapping Search on a slow link starts a route change to
 *  /search and shows nothing until that route's chunk and payload arrive ,
 *  the tap looks ignored and you can't type. The fix moved the search UI
 *  into the already-loaded app shell as an overlay (components/search),
 *  opened from shell state (stores/useUiStore's searchOpen), not a route.
 *
 *  This drives a real Chromium tab, loads the shell once while the network
 *  is healthy, then throttles the connection near to nothing (CDP
 *  Network.emulateNetworkConditions: heavy latency, ~1kbps either way,
 *  NOT offline: offline flips useOnline() and swaps in a different message,
 *  which is not what "slow" means here) and clicks Search. The invariant:
 *  the overlay and its input appear well under the throttled round-trip
 *  time, typing lands immediately, and the shell (sidebar/nav) never
 *  disappears: no blank screen at any point.
 *
 *  The desktop shape changed since: search is no longer a modal dialog on a
 *  desktop window but a real search box at the top of the content column
 *  with a non-modal dropdown of results under it ("Search without losing
 *  your place"). So the checks below ask about the PANEL
 *  (`[data-testid="search-dropdown"]`) where they used to ask about the
 *  input, which is now always in the page, and the last block checks the
 *  thing the change is for: with the dropdown open, the player bar, the
 *  sidebar and the page behind it are all still live. A phone (below `md`)
 *  keeps the full-screen sheet, and is checked at 390 alongside.
 *
 *  Needs the sandbox from tests/README.md and playwright-core. Set
 *  CHROME_PATH to pick a browser. */
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

const PB = process.env.PB_URL ?? 'http://127.0.0.1:8091';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:3010';
const PASSWORD = 'BugTest2026!';

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
const email = `instant-search-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
const created = await fetch(`${PB}/api/collections/users/records`, { method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: token },
  body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name: 'Instant Search Tester', verified: true }) });
if (!created.ok) throw new Error(`could not create test user: ${created.status}`);
const auth = await fetch(`${PB}/api/collections/users/auth-with-password`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PASSWORD }) })
  .then((r) => r.json());
const cookie = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
await ctx.addCookies([{ name: 'pb_auth', value: cookie, domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` : ${detail}` : ''}`);
};

// Catches base-ui's own Escape/outside-click dismissal fighting our explicit
// handler (SearchOverlay.tsx owns Escape and the close button rather than
// relying only on the dialog primitive): a double-close, a setState on an
// unmounted popup, or a React error would throw here. Uncaught exceptions
// only (pageerror), not console.error: under the throttled connection the
// browser itself logs "Failed to load resource: 503/500" for the search
// request that can't complete in time, which is expected noise, not a bug.
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

// Load once with a healthy connection: the whole point is that the shell
// (and the overlay's own chunk, part of the same bundle) is already loaded
// before the network goes bad.
await page.goto(`${APP}/`, { waitUntil: 'networkidle' });
await page.getByRole('link', { name: 'Home' }).first().waitFor({ timeout: 5000 });

// Throttle hard: 1.5s latency, ~1kbps either way. Not setOffline: offline
// flips useOnline() to show "No connection…" instead of results, which is a
// different code path than "slow". A real search API round-trip cannot
// complete inside this test's timeouts at this throughput.
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 1500,
  downloadThroughput: (1000 / 8),
  uploadThroughput: (1000 / 8),
});

const searchLink = page.getByRole('link', { name: 'Search' }).first();
await searchLink.waitFor({ timeout: 2000 });

// The desktop search box is in the page at all times now; what has to
// appear instantly is the results panel it opens.
const PANEL = '[data-testid="search-dropdown"]';
const panel = page.locator(PANEL);

const t0 = Date.now();
await searchLink.click();
const input = page.getByPlaceholder('What do you want to listen to?');
await input.waitFor({ state: 'visible', timeout: 1000 });
await panel.waitFor({ state: 'visible', timeout: 1000 });
const openedMs = Date.now() - t0;

check('overlay input appears well under a round-trip at this throughput',
  openedMs < 1500, `${openedMs}ms`);

await input.waitFor({ state: 'focused', timeout: 1000 }).catch(() => {});
const focused = await input.evaluate((el) => el === document.activeElement);
check('input is focused on open, with the network throttled', focused);

// Empty query, brand-new test user with no recent searches yet: the panel
// shows the calm one-liner, no "Trending" heading and no empty "No tracks"
// list under it (that block was dropped from the overlay entirely).
const emptyStateText = (await panel.innerText()).trim();
check('empty query shows the calm line, not a "Trending" heading',
  emptyStateText.includes('Search for a song, artist or album') && !emptyStateText.includes('Trending'),
  emptyStateText);
check('empty query has no leftover "No tracks" list', !emptyStateText.includes('No tracks'),
  emptyStateText);

// The shell never disappeared: the sidebar (loaded before the throttle
// kicked in) is still there beside the dropdown. A CSS locator rather than
// getByRole is what this used to need when search was a modal dialog (a
// dialog pulls the rest of the page out of the accessibility tree); the
// dropdown does not, but the check is about pixels on screen either way.
const sidebarVisible = await page.locator('aside a[aria-label="Home"]').first().isVisible();
check('the app shell (nav) stayed on screen: no blank transition', sidebarVisible);

await input.fill('daft punk');
const typedValue = await input.inputValue();
check('typing lands immediately, before any response can arrive', typedValue === 'daft punk',
  `got "${typedValue}"`);

// Body text should never have gone empty at any point above; a coarse final
// check that something real (not a blank document) is on screen right now.
const bodyText = (await page.locator('body').innerText()).trim();
check('body is not blank', bodyText.length > 0, `${bodyText.length} chars`);

await input.fill('');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const closedByEscape = !(await panel.isVisible().catch(() => false));
check('Escape dismisses the overlay', closedByEscape);

// Restore the network for the rest: what's left is about the dialog's own
// dismiss paths, not the slow-connection behavior.
await cdp.send('Network.emulateNetworkConditions', {
  offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
});

// Reopen and dismiss with a click outside the panel. There is no backdrop
// to catch it any more: SearchDropdown listens for a pointerdown that lands
// outside its own box. Does that fight its Escape handling? Two closes
// racing would either double-fire state updates or throw; the pageerror
// listener above would catch it.
await searchLink.click();
await panel.waitFor({ state: 'visible', timeout: 2000 });
await page.mouse.click(10, 10); // corner of the viewport, outside the panel
await page.waitForTimeout(300);
const closedByOutsideClick = !(await panel.isVisible().catch(() => false));
check('clicking outside the popup dismisses it too, no conflict with our Escape handler',
  closedByOutsideClick);

check('no console/page errors from the overlay\'s open/close paths (Escape, close button, outside click)',
  pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

// Regression: the overlay caps at max-w-xl (~576px) regardless of window
// size, but TrackRow's desktop 5-column shape (album + duration columns)
// used to switch on the *viewport* (md: 768px), not the space the row
// actually has. On any window at least 768px wide, that put the overlay's
// rows in the desktop shape squeezed into ~544px, splitting title and
// album into equal, too-narrow halves (titles like "Yes Sir, I Can Boogie"
// truncated to "Yes Sir, I…"). Checked at 1280x720 and 1536x864: both are
// well past 768px viewport width, so both used to reproduce it.
for (const size of [{ width: 1280, height: 720 }, { width: 1536, height: 864 }]) {
  await page.setViewportSize(size);
  await searchLink.click();
  await panel.waitFor({ state: 'visible', timeout: 2000 });
  await input.fill('yes sir');
  await page.getByText('Results for').first().waitFor({ timeout: 15000 });
  await page.locator('[data-testid="track-row"]').first().waitFor({ timeout: 15000 });

  const dialogBox = await panel.boundingBox();
  const label = `${size.width}x${size.height}`;
  check(`overlay stays fully inside the viewport at ${label}`,
    !!dialogBox && dialogBox.x >= 0 && dialogBox.x + dialogBox.width <= size.width,
    dialogBox ? `left=${dialogBox.x} right=${dialogBox.x + dialogBox.width} viewport=${size.width}` : 'no dialog box');

  const rows = await page.locator('[data-testid="track-row"]').all();
  let minRatio = Infinity;
  for (const row of rows) {
    const rowBox = await row.boundingBox();
    const titleBox = await row.locator('[data-testid="track-row-title-cell"]').boundingBox();
    if (!rowBox || !titleBox || rowBox.width === 0) continue;
    minRatio = Math.min(minRatio, titleBox.width / rowBox.width);
  }
  check(`every result title is at least 45% of its row width at ${label}`,
    rows.length > 0 && minRatio >= 0.45, `${rows.length} rows, min ratio ${minRatio.toFixed(2)}`);

  await input.fill('');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

// The search-row play controls (the /dizajn "Search rows" pick: a trailing
// play/pause button on every row, the current row marked by its title in
// the ember accent, no glyph). Driven against the real player: playing is
// a real stream, not a mocked flag.
const ROW_PLAY = '[data-testid="track-row-play"]';

/** Opens search from whichever nav is on screen (the sidebar on a desktop
 *  window, the bottom bar on a phone) and waits for real results. On a
 *  desktop window the box is already in the page, so what has to show up is
 *  the panel; on a phone the whole sheet does. */
async function openWithResults(query) {
  await page.getByRole('link', { name: 'Search' }).first().click();
  await input.waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('[data-testid="search-dropdown"], [data-slot="dialog-content"]')
    .first().waitFor({ state: 'visible', timeout: 5000 });
  await input.fill(query);
  await page.getByText('Results for').first().waitFor({ timeout: 20000 });
  await page.locator('[data-testid="track-row"]').first().waitFor({ timeout: 20000 });
}

async function closeOverlay() {
  await input.fill('');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
}

/** The label of every row's play control, in row order. */
function rowLabels() {
  return page.locator(ROW_PLAY).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
}

/** The titles currently drawn in the ember accent. */
function emberTitles() {
  return page
    .locator('[data-testid="track-row-title"]')
    .evaluateAll((els) => els.filter((e) => e.className.includes('text-ember')).map((e) => e.textContent.trim()));
}

for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  const label = `${size.width}x${size.height}`;
  // The first pass starts with a player that has never played anything;
  // the second inherits whatever the first left current, so the
  // "nothing is marked yet" checks only make sense the first time.
  const fresh = size.width === 1280;
  await page.setViewportSize(size);
  await openWithResults('yes sir');

  const labels = await rowLabels();
  const rowCount = await page.locator('[data-testid="track-row"]').count();
  check(`every result row has a play control naming its song at ${label}`,
    labels.length >= rowCount && labels.length > 1 &&
      labels.every((l) => /^(Play|Pause|Resume) ./.test(l ?? '')),
    `${labels.length} controls for ${rowCount} rows, first "${labels[0]}"`);

  if (fresh) {
    check(`no row is marked before anything plays at ${label}`, (await emberTitles()).length === 0);
    check(`every control offers Play before anything plays at ${label}`,
      labels.every((l) => l.startsWith('Play ')), `first "${labels[0]}"`);
  }

  // Play the first row from its own control.
  const firstLabel = labels[0];
  const first = firstLabel.slice(firstLabel.indexOf(' ') + 1);
  await page.locator(ROW_PLAY).first().click();
  const firstPause = page.getByRole('button', { name: `Pause ${first}`, exact: true }).first();
  const started = await firstPause.waitFor({ timeout: 25000 }).then(() => true).catch(() => false);
  check(`pressing a row's play button starts that song at ${label}`, started, `"${first}"`);

  const marked = await emberTitles();
  check(`the playing row shows the pause button and an ember title at ${label}`,
    started && marked.length === 1 && marked[0] === first, `ember titles: ${JSON.stringify(marked)}`);

  // The same button pauses, and its icon (so its label) flips.
  await firstPause.click();
  const flipped = await page.getByRole('button', { name: `Resume ${first}`, exact: true }).first()
    .waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  const stillMarked = await emberTitles();
  check(`pressing it again pauses and the icon flips at ${label}`, flipped, `"${first}"`);
  check(`a paused row keeps its ember title and nothing else changes at ${label}`,
    stillMarked.length === 1 && stillMarked[0] === first, JSON.stringify(stillMarked));

  // A different row's button takes over.
  const others = (await rowLabels()).map((l, i) => [l, i]).filter(([l]) => l.startsWith('Play '));
  const [otherLabel, otherIndex] = others[others.length - 1];
  const other = otherLabel.slice('Play '.length);
  await page.locator(ROW_PLAY).nth(otherIndex).click();
  const tookOver = await page.getByRole('button', { name: `Pause ${other}`, exact: true }).first()
    .waitFor({ timeout: 25000 }).then(() => true).catch(() => false);
  const movedTo = await emberTitles();
  check(`pressing a different row's button plays that one at ${label}`, tookOver, `"${other}"`);
  check(`the ember title moves to the new row at ${label}`,
    movedTo.length === 1 && movedTo[0] === other, JSON.stringify(movedTo));

  // Nothing overflows: not the page, not a single row.
  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth - window.innerWidth,
    row: Math.max(0, ...[...document.querySelectorAll('[data-testid="track-row"]')]
      .map((r) => r.scrollWidth - r.clientWidth)),
  }));
  check(`nothing overflows at ${label}`, overflow.page <= 0 && overflow.row <= 0,
    `page +${overflow.page}px, worst row +${overflow.row}px`);

  // Tab from the search box: a row's play control must be reachable.
  await input.focus();
  let reached = null;
  for (let i = 0; i < 12 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() =>
      document.activeElement?.dataset?.testid === 'track-row-play'
        ? document.activeElement.getAttribute('aria-label')
        : null);
  }
  check(`a row's play button is reachable by Tab at ${label}`, !!reached, reached ?? 'never focused');

  await closeOverlay();
}

// ---------------------------------------------------------------------
// The dropdown is NON-MODAL: the whole point of the change. With it open,
// the player bar, the sidebar and the page behind it stay live. Run at
// 1280 and 1440; the phone sheet is checked after, and must still be the
// modal it always was.
// ---------------------------------------------------------------------

/** What is actually on top at the centre of `locator`: a covered element
 *  (a backdrop over it, say) fails this, a reachable one passes. The real
 *  question a non-modal panel has to answer. */
async function topmostAt(locator) {
  const b = await locator.boundingBox();
  if (!b) return null;
  return page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    return {
      inFooter: !!el.closest('footer'),
      inSidebar: !!el.closest('aside'),
      label: el.closest('button,a')?.getAttribute('aria-label') ?? el.tagName,
    };
  }, [b.x + b.width / 2, b.y + b.height / 2]);
}

for (const size of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
  const label = `${size.width}x${size.height}`;
  await page.setViewportSize(size);
  await openWithResults('yes sir');

  // Nothing modal about it: no backdrop element, nothing on screen marked
  // aria-modal, nothing pulled out of the accessibility tree, and the panel
  // itself sits inside no dialog at all. (`aria-modal` is counted only for
  // boxes with a height: the phone NowPlaying sheet is always mounted, off
  // screen and `md:hidden`, and has been since long before this.)
  const modalMarks = await page.evaluate(() => ({
    backdrops: document.querySelectorAll('[data-slot="dialog-overlay"]').length,
    ariaModal: [...document.querySelectorAll('[aria-modal="true"]')]
      .filter((e) => e.getBoundingClientRect().height > 0).length,
    hidden: document.querySelectorAll('aside[aria-hidden="true"], footer[aria-hidden="true"]').length,
    panelInDialog: !!document.querySelector('[data-testid="search-dropdown"]')
      ?.closest('[role="dialog"], [aria-modal]'),
  }));
  check(`the dropdown draws no backdrop and marks nothing aria-modal at ${label}`,
    modalMarks.backdrops === 0 && modalMarks.ariaModal === 0 && modalMarks.hidden === 0
      && modalMarks.panelInDialog === false,
    JSON.stringify(modalMarks));

  // Fits the window, and stops above the player bar rather than running
  // under it.
  const panelBox = await page.locator(PANEL).boundingBox();
  const barTop = (await page.locator('footer').boundingBox())?.y ?? size.height;
  check(`the dropdown stays inside the viewport and above the player bar at ${label}`,
    !!panelBox && panelBox.x >= 0 && panelBox.y >= 0
      && panelBox.x + panelBox.width <= size.width
      && panelBox.y + panelBox.height <= Math.min(size.height, barTop),
    panelBox ? `panel bottom=${Math.round(panelBox.y + panelBox.height)} bar top=${Math.round(barTop)} viewport=${size.height}` : 'no panel');

  // Many results, one panel: it scrolls inside itself.
  const scrolls = await page.locator(PANEL).evaluate((el) => el.scrollHeight > el.clientHeight + 1);
  check(`the dropdown scrolls internally rather than growing at ${label}`, scrolls);

  // Start a song FROM the dropdown, and keep searching: it must not close.
  const firstLabel = (await rowLabels())[0];
  const first = firstLabel.slice(firstLabel.indexOf(' ') + 1);
  await page.locator(ROW_PLAY).first().click();
  const started = await page.getByRole('button', { name: `Pause ${first}`, exact: true }).first()
    .waitFor({ timeout: 25000 }).then(() => true).catch(() => false);
  const stillOpen = await page.locator(PANEL).isVisible();
  const marked = await emberTitles();
  check(`pressing a row's play starts the song and the dropdown STAYS open at ${label}`,
    started && stillOpen, `started=${started} open=${stillOpen}`);
  check(`the playing row keeps its ember title with the dropdown open at ${label}`,
    marked.length === 1 && marked[0] === first, JSON.stringify(marked));

  // The player bar is not just visible, it is reachable and it works.
  const barToggle = page.locator('footer button[aria-label="Pause"], footer button[aria-label="Play"]').first();
  const overBar = await topmostAt(barToggle);
  check(`the player bar's play/pause is the topmost thing at its own position at ${label}`,
    !!overBar && overBar.inFooter, JSON.stringify(overBar));

  const wasPause = (await barToggle.getAttribute('aria-label')) === 'Pause';
  await barToggle.click();
  const flipped = await page.locator(`footer button[aria-label="${wasPause ? 'Play' : 'Pause'}"]`).first()
    .waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  check(`clicking the player bar works with the dropdown open at ${label}`, flipped,
    `was ${wasPause ? 'Pause' : 'Play'}`);
  // It lands on the button AND counts as a click outside the panel, so the
  // panel closes: one press, both things, nothing swallowed. (Under the old
  // modal the press hit the backdrop and the player bar never saw it.)
  const openAfterBar = await page.locator(PANEL).isVisible().catch(() => false);
  check(`the player bar press is also a click-outside, so the dropdown closes at ${label}`,
    !openAfterBar);

  // The sidebar too.
  await openWithResults('yes sir');
  const sidebarLink = page.locator('aside a[href="/library/liked"]').first();
  const overSidebar = await topmostAt(sidebarLink);
  check(`the sidebar is the topmost thing at its own position at ${label}`,
    !!overSidebar && overSidebar.inSidebar, JSON.stringify(overSidebar));

  // Escape closes it, and hands focus back to whatever opened it.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const closed = !(await page.locator(PANEL).isVisible().catch(() => false));
  const focusLeftTheBox = await page.evaluate(() =>
    document.activeElement?.getAttribute('placeholder') !== 'What do you want to listen to?');
  check(`Escape closes the dropdown at ${label}`, closed);
  check(`Escape takes focus back out of the search box at ${label}`, focusLeftTheBox);

  // "/" still opens search and puts the caret in the box: same shortcut,
  // same isTypingTarget guard, it just focuses the in-page box now.
  await page.keyboard.press('/');
  const reopened = await page.locator(PANEL).waitFor({ state: 'visible', timeout: 2000 })
    .then(() => true).catch(() => false);
  const boxFocused = await page.evaluate(() =>
    document.activeElement?.getAttribute('placeholder') === 'What do you want to listen to?');
  const slashTyped = await input.inputValue();
  check(`"/" opens search and focuses the box at ${label}`, reopened && boxFocused,
    `open=${reopened} focused=${boxFocused}`);
  check(`"/" is not typed into the box at ${label}`, !slashTyped.includes('/'), `"${slashTyped}"`);

  // Arrow keys walk the rows from the box and back up to it.
  await input.fill('yes sir');
  await page.locator('[data-testid="track-row"]').first().waitFor({ timeout: 20000 });
  const walk = [];
  const here = () => page.evaluate(() =>
    document.activeElement?.dataset?.testid === 'track-row-play'
      ? document.activeElement.getAttribute('aria-label')
      : document.activeElement?.getAttribute('placeholder') ?? document.activeElement?.tagName);
  for (const key of ['ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowUp']) {
    await page.keyboard.press(key);
    walk.push(await here());
  }
  // The first row may read "Resume …" rather than "Play …": it is whatever
  // was started from search earlier, now paused. What matters is that the
  // focus lands on a row control, moves on, comes back, and ends in the box.
  const onARow = (s) => /^(Play|Pause|Resume) ./.test(s ?? '');
  check(`arrow keys walk the result rows and return to the box at ${label}`,
    onARow(walk[0]) && onARow(walk[1]) && walk[1] !== walk[0]
      && walk[2] === walk[0] && walk[3] === 'What do you want to listen to?',
    JSON.stringify(walk));

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // A real click on the sidebar navigates, and that closes the dropdown.
  await openWithResults('yes sir');
  await sidebarLink.click();
  await page.waitForURL('**/library/liked', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);
  const navigated = page.url().includes('/library/liked');
  const closedByNav = !(await page.locator(PANEL).isVisible().catch(() => false));
  check(`clicking the sidebar while the dropdown is open navigates at ${label}`, navigated, page.url());
  check(`navigating closes the dropdown at ${label}`, closedByNav);

  await page.goto(`${APP}/`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Home' }).first().waitFor({ timeout: 10000 });
}

// The phone keeps today's full-screen sheet, modal and all: on a phone
// there is nothing behind it worth reaching.
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${APP}/`, { waitUntil: 'networkidle' });
await openWithResults('yes sir');

const sheetMarks = await page.evaluate(() => ({
  backdrops: document.querySelectorAll('[data-slot="dialog-overlay"]').length,
  ariaModal: document.querySelectorAll('[data-slot="dialog-content"][aria-modal="true"], [role="dialog"][aria-modal="true"]').length,
  dropdown: document.querySelectorAll('[data-testid="search-dropdown"]').length,
}));
check('the phone still gets the modal full-screen sheet, not the dropdown',
  sheetMarks.backdrops === 1 && sheetMarks.ariaModal >= 1 && sheetMarks.dropdown === 0,
  JSON.stringify(sheetMarks));

const sheetBox = await page.locator('[data-slot="dialog-content"]').boundingBox();
check('the phone sheet stays inside the 390px viewport',
  !!sheetBox && sheetBox.x >= 0 && sheetBox.x + sheetBox.width <= 390,
  sheetBox ? `left=${sheetBox.x} right=${sheetBox.x + sheetBox.width}` : 'no sheet');

check('the phone sheet still has its close button',
  await page.getByRole('button', { name: 'Close search' }).first().isVisible());

await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('the phone sheet still closes on Escape',
  !(await page.locator('[data-slot="dialog-content"]').isVisible().catch(() => false)));

check('no console/page errors from the non-modal dropdown or the phone sheet',
  pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();

const failed = checks.filter(([, p]) => !p);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map(([n]) => n).join(', '));
process.exit(failed.length ? 1 : 0);
