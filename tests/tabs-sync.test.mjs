/** STRICT verification that the tab page (/tabs/[trackId]) stays in sync
 *  with Ember's real playback (docs/tabs-rebuild.md section 4, lib/tabSync.ts).
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
 *      player there; dragging the cursor is checked honestly and FAILS
 *      the "drag the line to seek" check if unsupported, without any
 *      product-code changes to make it pass.
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

/** Real playback time, seconds, read from the actual (detached) audio
 *  element the web backend drives — sub-second precision, not the
 *  1-second-rounded position the store/footer shows. */
const realTime = (page) =>
  page.evaluate(() => {
    const a = window.__audios?.[window.__audios.length - 1];
    return a ? a.currentTime : null;
  });
const realDuration = (page) =>
  page.evaluate(() => {
    const a = window.__audios?.[window.__audios.length - 1];
    return a && Number.isFinite(a.duration) ? a.duration : null;
  });

/** Every bar-number label AlphaTab draws (its distinctive muted grey
 *  fill), in viewport pixels: {n, x, y}. All 32 exist in the DOM at once
 *  (Page layout is not virtualised) — only their visibility changes with
 *  scroll, which is exactly what "follows the song" is checking. */
const barLabels = (page) =>
  page.evaluate(() => {
    const texts = [...document.querySelectorAll('[data-testid="tab-score"] text')];
    return texts
      .filter((t) => /^rgba\(156,\s*158,\s*162/.test(t.getAttribute('fill') || '') && /^\d+$/.test(t.textContent?.trim() || ''))
      .map((t) => {
        const r = t.getBoundingClientRect();
        return { n: Number(t.textContent.trim()), x: r.x, y: r.y };
      });
  });

const cursorRect = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.at-cursor-beat');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { x: r.x, y: r.y, w: r.width, h: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  });

/** The visible band the cursor must stay in: below the sticky toolbar,
 *  above the player bar (docs/tabs-rebuild.md section 4, followScroll). */
const viewBand = (page) =>
  page.evaluate(() => {
    const sticky = document.querySelector('[data-testid="tabs-sticky"]')?.getBoundingClientRect();
    const foot = document.querySelector('footer')?.getBoundingClientRect();
    return { top: sticky ? sticky.bottom : 0, bottom: foot ? foot.top : window.innerHeight };
  });

/** Row-cluster the bar labels around `y`, sorted left to right: AlphaTab
 *  wraps bars into rows (vertical) or draws one long row (horizontal). */
function rowAt(labels, y) {
  if (labels.length === 0) return [];
  let nearest = labels[0];
  for (const l of labels) if (Math.abs(l.y - y) < Math.abs(nearest.y - y)) nearest = l;
  return labels.filter((l) => Math.abs(l.y - nearest.y) < 40).sort((a, b) => a.x - b.x);
}

/** Where the cursor is, as a fractional bar number (10.3 = 30% into bar
 *  10), by interpolating between the two bar-number labels either side
 *  of it on its row. Falls back to the bar's own number (no fraction) at
 *  the edges. */
function barPositionFromCursor(labels, cursor) {
  // The cursor rect spans the full staff height; its vertical centre sits
  // more reliably inside its own row than its top edge does near a row
  // boundary.
  const row = rowAt(labels, cursor.y + (cursor.h ?? 0) / 2);
  if (row.length === 0) return null;
  let loIdx = 0;
  for (let i = 0; i < row.length; i++) {
    if (row[i].x <= cursor.x + 1) loIdx = i;
    else break;
  }
  const lo = row[loIdx];
  const hi = row[loIdx + 1];
  // The last bar of a row has no next label to interpolate against. Bar
  // widths vary a lot with note density (a bar of straight quarter notes
  // vs. a bar of sixteenths), so falling back to just the previous pair's
  // width is noisy; the row's average bar width is a steadier estimate
  // for how far the last bar likely extends.
  let width = hi ? hi.x - lo.x : null;
  if (!width && row.length > 1) {
    width = (row[row.length - 1].x - row[0].x) / (row.length - 1);
  }
  if (width && width > 0) {
    const frac = Math.max(0, Math.min(1, (cursor.x - lo.x) / width));
    return lo.n + frac;
  }
  return lo.n;
}

function expectedBarPosition(realSec, offsetMs) {
  const tabSec = realSec + offsetMs / 1000;
  return Math.min(BAR_COUNT, Math.max(1, tabSec / BAR_SEC + 1));
}

function barPositionToSongSec(barPos, offsetMs) {
  return (barPos - 1) * BAR_SEC - offsetMs / 1000;
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
        ? `dropping at bar ${targetLabel.n} seeked the song to ${afterD.toFixed(2)}s (expected ~${expectDrop.toFixed(2)}s)`
        : `NOT SUPPORTED: pressed at bar 6 (~${expectPress.toFixed(2)}s) and dragged to bar ${targetLabel.n} (~${expectDrop.toFixed(2)}s), but the song ended up at ${afterD === null ? 'no reading' : `${afterD.toFixed(2)}s`} before ${beforeD?.toFixed(2)}s — ${seekedToPress ? 'only the initial press point took effect; the drop was ignored' : 'no click-through seek was registered at all on a mouse-down + drag'}`,
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
    const [t, c, labels] = await Promise.all([realTime(phonePage), cursorRect(phonePage), barLabels(phonePage)]);
    const barPos = c ? barPositionFromCursor(labels, c) : null;
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

  await phonePage.context().close();
}

const noisy = consoleErrors.filter((e) => !/favicon|404/.test(e));
check('no unexpected console errors', noisy.length === 0, noisy.slice(0, 2).join(' | '));

await browser.close();
const failed = checks.filter(([, p]) => !p);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map(([n]) => n).join(', '));
process.exit(failed.length ? 1 : 0);
