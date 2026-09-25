/** STRICT verification that the tab page (/tabs/[trackId]) stays in sync
 *  with Ember's real playback (lib/tabSync.ts).
 *  Three owner requirements, each a group of checks:
 *
 *   1. The tab follows the song: the cursor stays inside the visible
 *      viewport (below the sticky toolbar, above the player bar) while
 *      the song plays, in both vertical and horizontal scroll modes.
 *   2. The line reflects the song's time: at several sample points
 *      (including paused, resumed, and seeked from the player bar) the
 *      bar the cursor sits in matches floor((time-offset)/2.5)+1 for the
 *      sample track (96 bpm, 4/4, one bar = 2.5s), within one beat.
 *   3. Moving the line controls the song: clicking a bar seeks the real
 *      player there; pressing on the cursor and dragging it to another bar
 *      seeks there on release (mouse at 1440, a finger at 390 through real
 *      touch input), and a vertical swipe on the score away from the line
 *      still scrolls the page without seeking.
 *   4. The line jumps with every seek and stays in view: a click on the
 *      next bar, a few Right presses and the Sync nudge put the line at
 *      the song's time within 0.2s (it used to slide there over a beat or
 *      two); paused, a seek from the player bar and a refresh mid-song
 *      bring the line into view; coming back to the page mid-song places
 *      it where the song is.
 *
 *  This is a verification test: it does not touch product code. On a
 *  failing check it reports the evidence (numbers, screenshots) rather
 *  than trying to fix anything.
 *
 *  Needs a running sandbox (reused, not started here): PocketBase on
 *  PB_URL, the app on APP_URL (built from the tabs-rebuild branch head),
 *  and the "Copper Sky" / Coastline sample already uploaded and tabbed.
 *
 *      node tests/tabs-sync.test.mjs        # or: npm run test:tabs-sync
 *
 *  Env overrides: PB_URL, APP_URL, TAB_EMAIL, TAB_PASSWORD, TAB_TRACK_ID,
 *  SHOTS_DIR, CHROME_PATH. */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  barLabels,
  barPositionFromCursor,
  cursorRect,
  realDuration,
  realTime,
  rowAt,
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
const EMAIL = process.env.TAB_EMAIL ?? 'strixparalel@gmail.com';
const PASSWORD = process.env.TAB_PASSWORD ?? 'EmberTest2026!';
const TRACK_ID = process.env.TAB_TRACK_ID ?? 'upload:955agv5lpd0x9ud';
const SHOTS_DIR =
  process.env.SHOTS_DIR ??
  '/private/tmp/claude-501/-Users-aronmatoic-Documents-Main-Projects/b6633bdb-0822-453b-a2b4-a986b08153a8/scratchpad/tabs-sync-shots';

// The sample: 96 bpm, 4/4, 32 bars -> one bar is 2.5s. Bar N starts at
// (N-1)*2.5s on the tab's own clock; offset_ms (read from the API, not
// assumed) shifts that against the recording (lib/tabSync.ts songToTabMs).
const BPM = 96;
const BEATS_PER_BAR = 4;
const BAR_SEC = (60 / BPM) * BEATS_PER_BAR; // 2.5
const BEAT_SEC = BAR_SEC / BEATS_PER_BAR; // 0.625
const BAR_COUNT = 32;
const TOLERANCE_SEC = BEAT_SEC + 0.2; // one beat plus a little slack for pixel/rounding error

fs.mkdirSync(SHOTS_DIR, { recursive: true });

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

async function signIn() {
  for (const p of ['/api/collections/users/auth-with-password']) {
    const res = await fetch(`${PB_URL}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: EMAIL, password: PASSWORD }),
    });
    if (res.ok) {
      const { token, record } = await res.json();
      return encodeURIComponent(JSON.stringify({ token, record }));
    }
  }
  throw new Error('could not sign in as the sandbox owner account');
}
const cookieValue = await signIn();

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const consoleErrors = [];
const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});

async function newPage(viewport, extra = {}) {
  const ctx = await browser.newContext({ viewport, ...extra });
  await ctx.addCookies([{ name: 'pb_auth', value: cookieValue, domain: new URL(APP_URL).hostname, path: '/' }]);
  // The web playback backend builds a plain `new Audio()` that is never
  // attached to the DOM, so `document.querySelector('audio')` finds
  // nothing. This wraps the constructor (test-only instrumentation, no
  // product code touched) so the real element — and its real
  // `currentTime` — is reachable for the "line reflects the song's time"
  // checks.
  await ctx.addInitScript(() => {
    const Native = window.Audio;
    window.__audios = [];
    const Wrapped = function (...args) {
      const el = new Native(...args);
      window.__audios.push(el);
      return el;
    };
    Wrapped.prototype = Native.prototype;
    window.Audio = Wrapped;
  });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  return page;
}

// ── page helpers ────────────────────────────────────────────────────────
const scoreReady = (page) =>
  page.waitForFunction(() => document.querySelector('[data-testid="tab-score"]')?.dataset.status === 'ready', null, {
    timeout: 30_000,
  });

async function play(page, title) {
  await page.goto(`${APP_URL}/library/uploads`, { waitUntil: 'networkidle' });
  await page.getByText(title, { exact: true }).first().click({ clickCount: 2 });
  await page.waitForTimeout(2000);
}

async function openTabsPage(page, { phone = false } = {}) {
  if (phone) {
    await page.locator('footer').getByText('Copper Sky').first().click();
    await page.waitForTimeout(800);
    await page.locator('[role="dialog"][aria-hidden="false"]').getByRole('button', { name: 'Guitar tabs' }).click();
  } else {
    await page.locator('footer').getByRole('button', { name: 'Guitar tabs' }).first().click();
  }
  await page.waitForURL((u) => u.pathname === `/tabs/${encodeURIComponent(TRACK_ID)}`, {
    timeout: 10_000,
    waitUntil: 'commit',
  }).catch(() => {});
  await scoreReady(page).catch(() => {});
  await page.waitForTimeout(1200);
}

/** offset_ms from the API for this track's tab, not assumed to be 0. */
async function getOffsetMs(page) {
  return page.evaluate(async (trackId) => {
    const res = await fetch(`/api/tabs/files?trackId=${encodeURIComponent(trackId)}&kind=all`, {
      credentials: 'same-origin',
    });
    const data = await res.json();
    return data.tabs?.[0]?.offsetMs ?? 0;
  }, TRACK_ID);
}

function expectedBarPosition(realSec, offsetMs) {
  const tabSec = realSec + offsetMs / 1000;
  return Math.min(BAR_COUNT, Math.max(1, tabSec / BAR_SEC + 1));
}

function barPositionToSongSec(barPos, offsetMs) {
  return (barPos - 1) * BAR_SEC - offsetMs / 1000;
}

/** The drag's ghost-line time label (m:ss), or null when none is shown. */
const dragLabel = (page) =>
  page.evaluate(() => document.querySelector('[data-testid="tab-line-time"]')?.textContent ?? null);

/** Real touch input through the DevTools protocol, so the page sees
 *  pointerType "touch" and the browser applies its own touch-action
 *  scrolling, as on a phone. */
async function touchPath(page, points, { holdMs = 0, onHold = null } = {}) {
  const cdp = await page.context().newCDPSession(page);
  const [first, ...rest] = points;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: first.x, y: first.y }] });
  for (const p of rest) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y }] });
    await page.waitForTimeout(16);
  }
  if (holdMs) await page.waitForTimeout(holdMs);
  if (onHold) await onHold();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach().catch(() => {});
}

function steps(from, to, n) {
  return Array.from({ length: n + 1 }, (_, i) => ({ x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n }));
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS_DIR, name) }).catch(() => {});
}

/** AlphaTab only fully lays out bars near the current scroll position (far
 *  rows get pruned as you scroll away, confirmed by inspecting the DOM
 *  directly), so a distant bar's label may not exist yet. Nudge the
 *  scroller toward its proportional position, a few times if needed,
 *  until AlphaTab has rendered it. */
async function scrollUntilBarRendered(page, n, scroller, horizontal) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const found = (await barLabels(page)).find((l) => l.n === n);
    if (found) return found;
    const frac = (n - 1) / (BAR_COUNT - 1);
    await page.evaluate(
      ({ sel, frac, horizontal }) => {
        const sc = document.querySelector(sel);
        if (!sc) return;
        if (horizontal) sc.scrollTo({ left: Math.max(0, frac * (sc.scrollWidth - sc.clientWidth)) });
        else sc.scrollTo({ top: Math.max(0, frac * (sc.scrollHeight - sc.clientHeight)) });
      },
      { sel: scroller, frac, horizontal },
    );
    await page.waitForTimeout(400);
  }
  return null;
}

/** Click a bar by its label (like tabs-ui's bar-12 click): scroll it into
 *  view first if a scroller is given, then click just under+right of the
 *  label, which lands on the bar's first beat. */
async function clickBar(page, n, { scroller = null } = {}) {
  let label = (await barLabels(page)).find((l) => l.n === n);
  if (scroller && !label) {
    label = await scrollUntilBarRendered(page, n, scroller, scroller.includes('tab-score'));
  }
  if (!label) return null;
  if (scroller) {
    // Everything here runs inside the page: `label.y`/`label.x` are
    // viewport-relative (getBoundingClientRect), and so is the scroller's
    // own rect, so the two combine correctly without any Node-side DOM
    // access (there is none — this is a headless test script).
    await page.evaluate(
      ({ sel, y, x, horizontal }) => {
        const sc = document.querySelector(sel);
        if (!sc) return;
        const box = sc.getBoundingClientRect();
        if (horizontal) sc.scrollTo({ left: Math.max(0, sc.scrollLeft + (x - box.left) - sc.clientWidth / 3) });
        else sc.scrollTo({ top: Math.max(0, sc.scrollTop + (y - box.top) - sc.clientHeight / 2) });
      },
      { sel: scroller, y: label.y, x: label.x, horizontal: scroller.includes('tab-score') },
    );
    await page.waitForTimeout(400);
    label = (await barLabels(page)).find((l) => l.n === n) ?? label;
  }
  let x = label.x + 40;
  let y = label.y + 45;
  if (scroller) {
    // Bars near the very end of the score can sit past the scroller's
    // maximum scroll extent (there is nothing left to scroll past), so
    // the centering above can leave the target just outside the visible
    // box even after clamping scrollLeft/scrollTop. Clamp the click point
    // itself into the scroller's visible rect as a last resort, rather
    // than clicking on nothing.
    const box = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }, scroller);
    if (box) {
      x = Math.max(box.left + 10, Math.min(x, box.right - 10));
      y = Math.max(box.top + 10, Math.min(y, box.bottom - 10));
    }
  }
  await page.mouse.click(x, y);
  return { x, y };
}

// ══════════════════════════════════════════════════════════════════════
// Main run: 1440x900
// ══════════════════════════════════════════════════════════════════════
const page = await newPage({ width: 1440, height: 900 });
await play(page, 'Copper Sky');
check('the player bar has a Guitar tabs button', (await page.locator('footer').getByRole('button', { name: 'Guitar tabs' }).count()) > 0);
await openTabsPage(page);
check('the tab page opened for the sample track', new URL(page.url()).pathname === `/tabs/${encodeURIComponent(TRACK_ID)}`, page.url());

const offsetMs = await getOffsetMs(page);
console.log(`\noffset_ms from the API: ${offsetMs}\n`);

const duration = (await realDuration(page)) ?? 82;

// ── Requirement 1: the tab follows the song ─────────────────────────────
console.log('\n=== 1. The tab follows the song ===\n');
{
  // From the start, vertical mode (the default), playing.
  const track = page.locator('footer [data-slot="slider-track"]');
  const trackBox = (async () => {
    const n = await track.count();
    for (let i = 0; i < n; i++) {
      const box = await track.nth(i).boundingBox();
      if (box && box.width > 20) return box;
    }
    return null;
  });
  const seekPlayerBar = async (sec) => {
    const box = await trackBox();
    if (!box) throw new Error('no visible seek track found in the footer');
    const pct = Math.max(0, Math.min(1, sec / duration));
    await page.mouse.click(box.x + box.width * pct, box.y + box.height / 2);
  };

  await seekPlayerBar(0.5);
  const playBtn = page.locator('footer').getByRole('button', { name: 'Play', exact: true });
  if (await playBtn.count()) await playBtn.click();
  await page.waitForTimeout(600);

  const samplesV = [];
  for (let i = 0; i < 8; i++) {
    const [c, band] = await Promise.all([cursorRect(page), viewBand(page)]);
    samplesV.push({ i, c, band });
    if (i === 3) await shot(page, 'cursor-midsong-vertical.png');
    await page.waitForTimeout(2500);
  }
  const violationsV = samplesV.filter(
    ({ c, band }) => !c || c.top < band.top - 2 || c.bottom > band.bottom + 2,
  );
  check(
    'vertical: the cursor stays inside the visible viewport while playing (~20s)',
    violationsV.length === 0,
    violationsV.length
      ? `${violationsV.length}/${samplesV.length} samples outside the band; e.g. cursor ${JSON.stringify(violationsV[0].c)} vs band ${JSON.stringify(violationsV[0].band)}`
      : `all ${samplesV.length} samples inside band (top ${Math.round(samplesV[0].band.top)}, bottom ${Math.round(samplesV[0].band.bottom)})`,
  );

  // Horizontal mode: seek near the end of a screen of bars so follow-scroll
  // has to move sideways to keep up.
  await page.getByRole('button', { name: 'Horizontal' }).click();
  await page.waitForTimeout(500);
  await seekPlayerBar(47.5); // bar 20
  if (!(await page.locator('footer').getByRole('button', { name: 'Pause', exact: true }).count())) {
    await page.locator('footer').getByRole('button', { name: 'Play', exact: true }).click();
  }
  await page.waitForTimeout(700);

  const viewportW = 1440;
  const samplesH = [];
  for (let i = 0; i < 6; i++) {
    const [c, scrollLeft] = await Promise.all([
      cursorRect(page),
      page.evaluate(() => document.querySelector('[data-testid="tab-score"]')?.scrollLeft ?? 0),
    ]);
    samplesH.push({ i, c, scrollLeft });
    if (i === 2) await shot(page, 'cursor-midsong-horizontal.png');
    await page.waitForTimeout(1500);
  }
  const violationsH = samplesH.filter(({ c }) => !c || c.left < -2 || c.right > viewportW + 2);
  check(
    'horizontal: the cursor stays within the visible width while playing',
    violationsH.length === 0,
    violationsH.length
      ? `${violationsH.length}/${samplesH.length} outside; e.g. ${JSON.stringify(violationsH[0].c)}`
      : `all ${samplesH.length} samples inside 0..${viewportW}`,
  );
  const scrollDelta = samplesH[samplesH.length - 1].scrollLeft - samplesH[0].scrollLeft;
  check(
    'horizontal: the score scrolls sideways as the song plays',
    scrollDelta > 5,
    `scrollLeft ${samplesH[0].scrollLeft} -> ${samplesH[samplesH.length - 1].scrollLeft} (Δ${scrollDelta})`,
  );

  await page.getByRole('button', { name: 'Horizontal' }).click(); // back to vertical
  await page.waitForTimeout(500);
}

// ── Requirement 2: the line reflects the song's time ────────────────────
console.log('\n=== 2. The line reflects the song\'s time ===\n');
{
  const track = page.locator('footer [data-slot="slider-track"]');
  const trackBox = async () => {
    const n = await track.count();
    for (let i = 0; i < n; i++) {
      const box = await track.nth(i).boundingBox();
      if (box && box.width > 20) return box;
    }
    return null;
  };
  const seekPlayerBar = async (sec) => {
    const box = await trackBox();
    const pct = Math.max(0, Math.min(1, sec / duration));
    await page.mouse.click(box.x + box.width * pct, box.y + box.height / 2);
  };
  const pauseBtn = () => page.locator('footer').getByRole('button', { name: 'Pause', exact: true });
  const playBtn = () => page.locator('footer').getByRole('button', { name: 'Play', exact: true });

  const sampleAt = async (label) => {
    const [t, c, labels] = await Promise.all([realTime(page), cursorRect(page), barLabels(page)]);
    const barPos = c ? barPositionFromCursor(labels, c) : null;
    const expected = t !== null ? expectedBarPosition(t, offsetMs) : null;
    const pass = t !== null && barPos !== null && Math.abs(barPos - expected) * BAR_SEC <= TOLERANCE_SEC;
    check(
      `t=${label}: cursor bar matches floor((time-offset)/${BAR_SEC})+1`,
      pass,
      `real time ${t?.toFixed(2)}s, cursor bar ${barPos?.toFixed(2)}, expected bar ${expected?.toFixed(2)} (Δ${((Math.abs((barPos ?? 0) - (expected ?? 0))) * BAR_SEC).toFixed(2)}s, tolerance ${TOLERANCE_SEC.toFixed(2)}s)`,
    );
    return { t, barPos, expected };
  };

  await seekPlayerBar(3);
  if (!(await pauseBtn().count())) await playBtn().click();
  await page.waitForTimeout(700);
  await sampleAt('~3s playing');

  await pauseBtn().click();
  await page.waitForTimeout(400);
  const p1 = await cursorRect(page);
  const t1 = await realTime(page);
  await sampleAt('paused');
  await page.waitForTimeout(3000);
  const p2 = await cursorRect(page);
  const t2 = await realTime(page);
  check(
    'paused: the cursor does not move for 3s',
    !!p1 && !!p2 && Math.abs(p1.x - p2.x) < 1 && Math.abs(p1.y - p2.y) < 1 && Math.abs((t2 ?? 0) - (t1 ?? 0)) < 0.05,
    `cursor ${JSON.stringify(p1)} -> ${JSON.stringify(p2)}, time ${t1?.toFixed(2)}s -> ${t2?.toFixed(2)}s`,
  );

  await playBtn().click();
  await page.waitForTimeout(700);
  await sampleAt('resumed');

  await seekPlayerBar(40);
  await page.waitForTimeout(1000);
  await sampleAt('seeked to 40s via the player bar');

  await seekPlayerBar(70);
  await page.waitForTimeout(1000);
  await sampleAt('seeked to 70s via the player bar');

  await page.waitForTimeout(2500);
  await sampleAt('~2.5s after the 70s seek, still playing');

  // Bar-start vs mid-bar: the cursor's x within the bar should differ. The
  // player bar's slider has ~1440px over 82s, too coarse to move by a
  // fraction of a 2.5s bar reliably, so this clicks two different beats
  // inside the same bar instead (still a real seek, via beatMouseDown).
  await pauseBtn().click().catch(() => {});
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('[data-app-scroller]')?.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const rowLabels = await barLabels(page);
  const bar10 = rowLabels.find((l) => l.n === 10);
  const bar11 = rowLabels.find((l) => l.n === 11);
  let cStart = null;
  let cMid = null;
  let tStart = null;
  let tMid = null;
  if (bar10 && bar11) {
    const w = bar11.x - bar10.x;
    const y = bar10.y + 45;
    await page.mouse.click(bar10.x + Math.max(10, w * 0.15), y);
    await page.waitForTimeout(500);
    cStart = await cursorRect(page);
    tStart = await realTime(page);
    await page.mouse.click(bar10.x + w * 0.7, y);
    await page.waitForTimeout(500);
    cMid = await cursorRect(page);
    tMid = await realTime(page);
  }
  check(
    'the cursor moves within the bar proportionally (an earlier vs later beat in the same bar differ)',
    !!cStart && !!cMid && Math.abs(cMid.x - cStart.x) > 3,
    !!bar10 && !!bar11
      ? `bar 10, early beat x=${cStart?.x?.toFixed(1)} (t=${tStart?.toFixed(2)}s) vs later beat x=${cMid?.x?.toFixed(1)} (t=${tMid?.toFixed(2)}s)`
      : 'could not find bar 10/11 labels to click within',
  );
  await page.locator('footer').getByRole('button', { name: 'Play', exact: true }).click().catch(() => {});
}

// ── Requirement 3: moving the line controls the song ────────────────────
console.log('\n=== 3. Moving the line controls the song ===\n');
{
  const pauseBtn = () => page.locator('footer').getByRole('button', { name: 'Pause', exact: true });
  const playBtn = () => page.locator('footer').getByRole('button', { name: 'Play', exact: true });
  const isPlayingNow = async () => (await pauseBtn().count()) > 0;

  // (a1) An earlier bar, playing, no scroll needed.
  await page.evaluate(() => document.querySelector('[data-app-scroller]')?.scrollTo(0, 0));
  await page.waitForTimeout(300);
  if (!(await isPlayingNow())) await playBtn().click();
  await page.waitForTimeout(400);
  const beforeA = await realTime(page);
  await shot(page, 'click-seek-before.png');
  await clickBar(page, 4);
  await page.waitForTimeout(350);
  const afterA = await realTime(page);
  const expectA = barPositionToSongSec(4, offsetMs);
  check(
    'click bar 4 (playing, no scroll): the song jumps there',
    afterA !== null && Math.abs(afterA - expectA) <= TOLERANCE_SEC,
    `${beforeA?.toFixed(2)}s -> ${afterA?.toFixed(2)}s, expected ~${expectA.toFixed(2)}s`,
  );
  check('click bar 4: playback continues (it was playing)', await isPlayingNow());
  await shot(page, 'click-seek-after.png');

  // (a2) A later bar on another row, paused.
  await pauseBtn().click().catch(() => {});
  await page.waitForTimeout(300);
  const beforeB = await realTime(page);
  await clickBar(page, 25, { scroller: '[data-app-scroller]' });
  await page.waitForTimeout(700);
  const afterB = await realTime(page);
  const expectB = barPositionToSongSec(25, offsetMs);
  check(
    'click bar 25 (paused, needs a scroll): the song jumps there',
    afterB !== null && Math.abs(afterB - expectB) <= TOLERANCE_SEC,
    `${beforeB?.toFixed(2)}s -> ${afterB?.toFixed(2)}s, expected ~${expectB.toFixed(2)}s`,
  );
  check('click bar 25: playback stays paused (it was paused)', !(await isPlayingNow()));

  // (a3) Horizontal mode, a bar needing a horizontal scroll.
  await page.getByRole('button', { name: 'Horizontal' }).click();
  await page.waitForTimeout(500);
  const beforeC = await realTime(page);
  await clickBar(page, 22, { scroller: '[data-testid="tab-score"]' });
  await page.waitForTimeout(700);
  const afterC = await realTime(page);
  const expectC = barPositionToSongSec(22, offsetMs);
  check(
    'click bar 22 in horizontal mode (needs a sideways scroll): the song jumps there',
    afterC !== null && Math.abs(afterC - expectC) <= TOLERANCE_SEC,
    `${beforeC?.toFixed(2)}s -> ${afterC?.toFixed(2)}s, expected ~${expectC.toFixed(2)}s`,
  );

  // (b) Dragging: press on the cursor line, drag it to a later bar, release.
  await page.getByRole('button', { name: 'Horizontal' }).click(); // back to vertical
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector('[data-app-scroller]')?.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await clickBar(page, 6); // put the cursor somewhere on screen, paused
  await page.waitForTimeout(500);
  const cur = await cursorRect(page);
  const labelsForDrag = await barLabels(page);
  const targetLabel = labelsForDrag.find((l) => l.n === 9) ?? labelsForDrag.find((l) => l.n === 8);
  await shot(page, 'drag-before.png');
  if (!cur || !targetLabel) {
    check('drag the line to seek', false, 'could not locate the cursor or a target bar to drag to — not tested');
  } else {
    const startX = cur.x + cur.w / 2;
    const startY = cur.y + cur.h / 2;
    const endX = targetLabel.x + 40;
    const endY = targetLabel.y + 45;
    const beforeD = await realTime(page);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move((startX + endX) / 2, (startY + endY) / 2, { steps: 5 });
    await page.mouse.move(endX, endY, { steps: 5 });
    await page.waitForTimeout(150);
    const ghostLabel = await dragLabel(page);
    await shot(page, 'drag-in-progress-1440.png');
    await page.mouse.up();
    await page.waitForTimeout(700);
    const afterD = await realTime(page);
    const expectDrop = barPositionToSongSec(targetLabel.n, offsetMs);
    const expectPress = barPositionToSongSec(6, offsetMs);
    await shot(page, 'drag-after.png');
    const seekedToDrop = afterD !== null && Math.abs(afterD - expectDrop) <= TOLERANCE_SEC;
    const seekedToPress = afterD !== null && Math.abs(afterD - expectPress) <= TOLERANCE_SEC;
    check(
      'drag the line to seek',
      seekedToDrop,
      seekedToDrop
        ? `dropping at bar ${targetLabel.n} seeked the song to ${afterD.toFixed(2)}s (expected ~${expectDrop.toFixed(2)}s; time label while dragging: ${ghostLabel ?? 'none'})`
        : `NOT SUPPORTED: pressed at bar 6 (~${expectPress.toFixed(2)}s) and dragged to bar ${targetLabel.n} (~${expectDrop.toFixed(2)}s), but the song ended up at ${afterD === null ? 'no reading' : `${afterD.toFixed(2)}s`} before ${beforeD?.toFixed(2)}s — ${seekedToPress ? 'only the initial press point took effect; the drop was ignored' : 'no click-through seek was registered at all on a mouse-down + drag'}`,
    );
  }
}

// ── Requirement 4: the line jumps with every seek, and stays in view ──────
// AlphaTab animates its line towards whatever position it is fed and only
// snaps it on a seek, so a small jump forward (a click on the next bar, a
// few arrow presses, the sync nudge) used to slide the line over a beat or
// two while the song was already there; and nothing scrolled to the line
// while paused. Each check reads the line within a fifth of a second of
// the action, where a slide is still visibly behind.
console.log('\n=== 4. The line jumps with every seek, and stays in view ===\n');
{
  const pauseBtn = () => page.locator('footer').getByRole('button', { name: 'Pause', exact: true });
  const playBtn = () => page.locator('footer').getByRole('button', { name: 'Play', exact: true });
  const trackBox = async () => {
    const track = page.locator('footer [data-slot="slider-track"]');
    for (let i = 0; i < (await track.count()); i++) {
      const box = await track.nth(i).boundingBox();
      if (box && box.width > 20) return box;
    }
    return null;
  };
  const seekPlayerBar = async (sec) => {
    const box = await trackBox();
    await page.mouse.click(box.x + box.width * Math.max(0, Math.min(1, sec / duration)), box.y + box.height / 2);
  };
  /** Song time the line shows vs the real player time, `offset` applied. */
  const lineVsSong = async (offset) => {
    const [t, c, labels] = await Promise.all([realTime(page), cursorRect(page), barLabels(page)]);
    const barPos = c ? barPositionFromCursor(labels, c) : null;
    if (t === null || barPos === null) return { t, barPos, delta: null };
    return { t, barPos, delta: Math.abs(barPos - expectedBarPosition(t, offset)) * BAR_SEC };
  };
  const inView = async () => {
    const [c, band] = await Promise.all([cursorRect(page), viewBand(page)]);
    return { ok: !!c && c.top >= band.top - 2 && c.bottom <= band.bottom + 2, c, band };
  };
  const scrollTop = () => page.evaluate(() => document.querySelector('[data-app-scroller]')?.scrollTop ?? 0);

  // (a) Playing, click the next bar on the line's own row.
  await page.evaluate(() => document.querySelector('[data-app-scroller]')?.scrollTo(0, 0));
  await seekPlayerBar(2.6 + 0.8); // bar 2, second beat
  if (!(await pauseBtn().count())) await playBtn().click();
  await page.waitForTimeout(600);
  {
    const t = await realTime(page);
    const n = Math.floor((t + offsetMs / 1000) / BAR_SEC) + 1;
    const labels = await barLabels(page);
    const cur = labels.find((l) => l.n === n);
    const next = labels.find((l) => l.n === n + 1 && cur && Math.abs(l.y - cur.y) < 40);
    if (!next) {
      check('playing, click the next bar: the line is there at once', false, `bar ${n + 1} is not on bar ${n}'s row`);
    } else {
      await page.mouse.click(next.x + 40, next.y + 45);
      await page.waitForTimeout(200);
      const r = await lineVsSong(offsetMs);
      check(
        'playing, click the next bar: the line is there within 0.2s',
        r.delta !== null && r.delta <= TOLERANCE_SEC,
        `clicked bar ${n + 1} from bar ${n}; 200ms later song ${r.t?.toFixed(2)}s, line at bar ${r.barPos?.toFixed(2)} (expected ${expectedBarPosition(r.t ?? 0, offsetMs).toFixed(2)}), off by ${r.delta?.toFixed(2)}s`,
      );
    }
  }

  // (b) Playing, three quick Right presses: three beats on.
  await page.waitForTimeout(800);
  await page.locator('[data-testid="tab-score"]').focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  {
    const r = await lineVsSong(offsetMs);
    check(
      'playing, Right three times: the line is there within 0.2s',
      r.delta !== null && r.delta <= TOLERANCE_SEC,
      `song ${r.t?.toFixed(2)}s, line at bar ${r.barPos?.toFixed(2)}, off by ${r.delta?.toFixed(2)}s`,
    );
  }

  // (c) Playing, nudge the tab 2s ahead: the line moves with the nudge.
  await page.getByRole('button', { name: 'Sync' }).click();
  await page.getByLabel('Tab timing offset in seconds').fill(String(offsetMs / 1000 + 2));
  await page.waitForTimeout(200);
  {
    const r = await lineVsSong(offsetMs + 2000);
    check(
      'playing, the Sync nudge moves the line within 0.2s',
      r.delta !== null && r.delta <= TOLERANCE_SEC,
      `nudged +2s: song ${r.t?.toFixed(2)}s, line at bar ${r.barPos?.toFixed(2)} (expected ${expectedBarPosition(r.t ?? 0, offsetMs + 2000).toFixed(2)}), off by ${r.delta?.toFixed(2)}s`,
    );
  }
  await page.getByRole('button', { name: 'Reset' }).click();
  await page.getByRole('button', { name: 'Sync' }).click();
  await page.waitForTimeout(400);

  // (d) Paused, the player bar far down the song: the page follows the line.
  await pauseBtn().click().catch(() => {});
  await page.evaluate(() => document.querySelector('[data-app-scroller]')?.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const topBefore = await scrollTop();
  await seekPlayerBar(72);
  await page.waitForTimeout(1200);
  {
    const v = await inView();
    const r = await lineVsSong(offsetMs);
    check(
      'paused, a seek from the player bar to a bar off screen brings the line into view',
      v.ok && r.delta !== null && r.delta <= TOLERANCE_SEC,
      `song ${r.t?.toFixed(2)}s, line ${v.c ? `${Math.round(v.c.top)}..${Math.round(v.c.bottom)}` : 'missing'} vs view ${Math.round(v.band.top)}..${Math.round(v.band.bottom)}, page scroll ${topBefore} -> ${await scrollTop()}`,
    );
  }

  // (e) Paused mid-song, refresh the page: the line is shown where the song is.
  await page.reload({ waitUntil: 'networkidle' });
  await scoreReady(page).catch(() => {});
  await page.waitForTimeout(1500);
  {
    const v = await inView();
    const r = await lineVsSong(offsetMs);
    check(
      'paused, after a refresh mid-song the line is in view at the song’s time',
      v.ok && r.delta !== null && r.delta <= TOLERANCE_SEC,
      `song ${r.t?.toFixed(2)}s, line at bar ${r.barPos?.toFixed(2)}, line ${v.c ? `${Math.round(v.c.top)}..${Math.round(v.c.bottom)}` : 'missing'} vs view ${Math.round(v.band.top)}..${Math.round(v.band.bottom)}`,
    );
  }

  // (f) Playing, leave the tab page and come back mid-song: the line is
  // placed where the song is, rather than sliding in from where it was.
  await seekPlayerBar(30);
  if (!(await pauseBtn().count())) await playBtn().click();
  await page.waitForTimeout(800);
  // In-app navigation, so the song keeps playing.
  await page.locator('a[href="/library/uploads"]').first().click();
  await page.waitForURL((u) => u.pathname === '/library/uploads', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.locator('footer').getByRole('button', { name: 'Guitar tabs' }).first().click();
  await scoreReady(page).catch(() => {});
  await page.waitForTimeout(400);
  {
    const r = await lineVsSong(offsetMs);
    const v = await inView();
    check(
      'back on the tab page mid-song: the line is in view at the song’s time',
      v.ok && r.delta !== null && r.delta <= TOLERANCE_SEC,
      `400ms after the score drew: song ${r.t?.toFixed(2)}s, line at bar ${r.barPos?.toFixed(2)}, off by ${r.delta?.toFixed(2)}s`,
    );
  }
}

// ── Requirement 2, briefly, at phone width ───────────────────────────────
console.log('\n=== 2 (repeat), phone viewport 390x844 ===\n');
{
  const phonePage = await newPage({ width: 390, height: 844 }, { hasTouch: true, isMobile: true });
  await play(phonePage, 'Copper Sky');
  await openTabsPage(phonePage, { phone: true });
  const offsetMsPhone = await getOffsetMs(phonePage);
  const durationPhone = (await realDuration(phonePage)) ?? duration;

  const track = phonePage.locator('footer [data-slot="slider-track"]');
  const trackBox = async () => {
    const n = await track.count();
    for (let i = 0; i < n; i++) {
      const box = await track.nth(i).boundingBox();
      if (box && box.width > 20) return box;
    }
    return null;
  };
  const seekPlayerBarPhone = async (sec) => {
    const box = await trackBox();
    if (!box) return false;
    const pct = Math.max(0, Math.min(1, sec / durationPhone));
    await phonePage.mouse.click(box.x + box.width * pct, box.y + box.height / 2);
    return true;
  };

  const sampleAtPhone = async (label) => {
    const [t, c, labels, right] = await Promise.all([
      realTime(phonePage),
      cursorRect(phonePage),
      barLabels(phonePage),
      phonePage.evaluate(() => document.querySelector('[data-testid="tab-score"]')?.getBoundingClientRect().right ?? null),
    ]);
    const barPos = c ? barPositionFromCursor(labels, c, right) : null;
    const expected = t !== null ? expectedBarPosition(t, offsetMsPhone) : null;
    const pass = t !== null && barPos !== null && Math.abs(barPos - expected) * BAR_SEC <= TOLERANCE_SEC;
    check(
      `phone t=${label}: cursor bar matches expected`,
      pass,
      `real time ${t?.toFixed(2)}s, cursor bar ${barPos?.toFixed(2)}, expected bar ${expected?.toFixed(2)}`,
    );
  };

  await page.waitForTimeout(200);
  await sampleAtPhone('~start');
  const ok40 = await seekPlayerBarPhone(40);
  await phonePage.waitForTimeout(700);
  if (ok40) await sampleAtPhone('seeked to 40s (phone)');
  else check('phone t=seeked to 40s (phone): cursor bar matches expected', false, 'no visible seek track found on the phone player bar');

  const phonePauseBtn = phonePage.locator('footer').getByRole('button', { name: 'Pause', exact: true });
  if (await phonePauseBtn.count()) await phonePauseBtn.click();
  await phonePage.waitForTimeout(300);
  const pp1 = await cursorRect(phonePage);
  await phonePage.waitForTimeout(2000);
  const pp2 = await cursorRect(phonePage);
  check(
    'phone: paused cursor holds still',
    !!pp1 && !!pp2 && Math.abs(pp1.x - pp2.x) < 1 && Math.abs(pp1.y - pp2.y) < 1,
    `${JSON.stringify(pp1)} -> ${JSON.stringify(pp2)}`,
  );

  // (3, phone) Drag the line with a finger: press on the cursor, drag it a
  // few bars on (onto another row), let go. Paused, it stays paused.
  await phonePage.evaluate(() => document.querySelector('[data-app-scroller]')?.scrollTo(0, 0));
  await phonePage.waitForTimeout(300);
  await clickBar(phonePage, 3, { scroller: '[data-app-scroller]' });
  await phonePage.waitForTimeout(600);
  const pc = await cursorRect(phonePage);
  const pBand = await viewBand(phonePage);
  const pLabels = await barLabels(phonePage);
  const pTarget = pLabels
    // Drop well clear of the band's edges: near one, the drag scrolls the
    // page on (by design), and the finger ends up over a later bar.
    .filter((l) => l.n >= 5 && l.n <= 9 && l.y + 35 > pBand.top + 70 && l.y + 35 < pBand.bottom - 70)
    .sort((a, b) => a.n - b.n)
    .pop();
  if (!pc || !pTarget) {
    check('phone: drag the line with a finger to seek', false, 'could not locate the cursor or a target bar on screen');
  } else {
    const from = { x: pc.x + pc.w / 2, y: pc.y + pc.h / 2 };
    const to = { x: Math.min(pTarget.x + 30, 380), y: pTarget.y + 35 };
    const beforeT = await realTime(phonePage);
    const scrollBefore = await phonePage.evaluate(() => document.querySelector('[data-app-scroller]')?.scrollTop ?? 0);
    let label = null;
    await touchPath(phonePage, steps(from, to, 12), {
      holdMs: 150,
      onHold: async () => {
        label = await dragLabel(phonePage);
        await shot(phonePage, 'drag-in-progress-390.png');
      },
    });
    await phonePage.waitForTimeout(800);
    const afterT = await realTime(phonePage);
    const scrollAfter = await phonePage.evaluate(() => document.querySelector('[data-app-scroller]')?.scrollTop ?? 0);
    const expectT = barPositionToSongSec(pTarget.n, offsetMsPhone);
    check(
      'phone: drag the line with a finger to seek',
      afterT !== null && Math.abs(afterT - expectT) <= TOLERANCE_SEC && label !== null,
      `touch-dragged from bar 3 (${beforeT?.toFixed(2)}s) to bar ${pTarget.n}: song at ${afterT?.toFixed(2)}s, expected ~${expectT.toFixed(2)}s; time label while dragging: ${label ?? 'none'}; page scroll ${scrollBefore} -> ${scrollAfter}`,
    );
    check('phone: after a drag, playback stays paused (it was paused)', !(await phonePauseBtn.count()));
  }

  // (3, phone) A vertical swipe on the score away from the line scrolls the
  // page, as always, and does not seek.
  {
    const c = await cursorRect(phonePage);
    const band = await viewBand(phonePage);
    const score = await phonePage.evaluate(() => {
      const r = document.querySelector('[data-testid="tab-score"]')?.getBoundingClientRect();
      return r ? { left: r.left, right: r.right } : null;
    });
    const scroller = '[data-app-scroller]';
    await phonePage.evaluate((sel) => document.querySelector(sel)?.scrollTo(0, 0), scroller);
    await phonePage.waitForTimeout(400);
    const c0 = (await cursorRect(phonePage)) ?? c;
    // Pick a column at least 80px from the line, in the middle of the band.
    const xs = [score.left + 40, score.right - 40, (score.left + score.right) / 2];
    const x = xs.find((v) => !c0 || Math.abs(v - (c0.x + c0.w / 2)) > 80) ?? xs[0];
    const y0 = band.top + (band.bottom - band.top) * 0.75;
    const tBefore = await realTime(phonePage);
    const sBefore = await phonePage.evaluate((sel) => document.querySelector(sel)?.scrollTop ?? 0, scroller);
    await touchPath(phonePage, steps({ x, y: y0 }, { x, y: y0 - 300 }, 15));
    await phonePage.waitForTimeout(900);
    const tAfter = await realTime(phonePage);
    const sAfter = await phonePage.evaluate((sel) => document.querySelector(sel)?.scrollTop ?? 0, scroller);
    check(
      'phone: a vertical swipe on the score (off the line) scrolls the page and does not seek',
      sAfter - sBefore > 60 && tBefore !== null && tAfter !== null && Math.abs(tAfter - tBefore) < 0.05,
      `swipe at x=${Math.round(x)} (line at x=${c0 ? Math.round(c0.x) : '?'}): page scroll ${sBefore} -> ${sAfter}, song ${tBefore?.toFixed(2)}s -> ${tAfter?.toFixed(2)}s`,
    );
  }

  await phonePage.context().close();
}

const noisy = consoleErrors.filter((e) => !/favicon|404/.test(e));
check('no unexpected console errors', noisy.length === 0, noisy.slice(0, 2).join(' | '));

await browser.close();
const failed = checks.filter(([, p]) => !p);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map(([n]) => n).join(', '));
process.exit(failed.length ? 1 : 0);
