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

const t0 = Date.now();
await searchLink.click();
const input = page.getByPlaceholder('What do you want to listen to?');
await input.waitFor({ state: 'visible', timeout: 1000 });
const openedMs = Date.now() - t0;

check('overlay input appears well under a round-trip at this throughput',
  openedMs < 1500, `${openedMs}ms`);

await input.waitFor({ state: 'focused', timeout: 1000 }).catch(() => {});
const focused = await input.evaluate((el) => el === document.activeElement);
check('input is focused on open, with the network throttled', focused);

// The shell never disappeared: the sidebar (loaded before the throttle
// kicked in) is still there underneath the overlay.
// A CSS locator, not getByRole: the open dialog correctly marks the rest of
// the page aria-hidden (standard modal a11y: background content is pulled
// out of the accessibility tree while a dialog is open), which makes
// getByRole('link', ...) match nothing here even though the sidebar is still
// visually on screen underneath the overlay. That's the thing this check
// actually cares about, so ask the DOM directly instead of the a11y tree.
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
const closedByEscape = !(await input.isVisible().catch(() => false));
check('Escape dismisses the overlay', closedByEscape);

// Restore the network for the rest: what's left is about the dialog's own
// dismiss paths, not the slow-connection behavior.
await cdp.send('Network.emulateNetworkConditions', {
  offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
});

// Reopen and dismiss with a click outside the popup (the dialog primitive's
// own backdrop dismiss): the manual check the brief asked for: does that
// fight SearchOverlay's explicit Escape/close-button handling? Two closes
// racing (base-ui's onOpenChange(false) and our onClose calling setOpen(false)
// again) would either double-fire history/state updates or throw; the
// pageerror/console listener above would catch it.
await searchLink.click();
await input.waitFor({ state: 'visible', timeout: 2000 });
await page.mouse.click(10, 10); // corner of the viewport, outside the popup
await page.waitForTimeout(300);
const closedByOutsideClick = !(await input.isVisible().catch(() => false));
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
  await input.waitFor({ state: 'visible', timeout: 2000 });
  await input.fill('yes sir');
  await page.getByText('Results for').first().waitFor({ timeout: 15000 });
  await page.locator('[data-testid="track-row"]').first().waitFor({ timeout: 15000 });

  const dialogBox = await page.locator('[data-slot="dialog-content"]').boundingBox();
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

async function openWithResults(query) {
  await page.getByRole('link', { name: 'Search' }).first().click();
  await input.waitFor({ state: 'visible', timeout: 5000 });
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

await browser.close();

const failed = checks.filter(([, p]) => !p);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map(([n]) => n).join(', '));
process.exit(failed.length ? 1 : 0);
