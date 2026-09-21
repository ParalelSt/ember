/** The phone player bar: two rows, big tap targets, a scrolling name, and a
 *  bar plus nav that stand clear of Android's system buttons.
 *
 *      node tests/mobile-player-ui.test.mjs     # or: npm run test:mobile-player
 *
 *  Drives a real Chromium tab at the two widths Android phones actually are
 *  (390x844 and 360x740), plays a long-titled upload and a short-titled one,
 *  and measures the bar that ships:
 *
 *    - every control's tap box is at least 48px, play at least 56px,
 *    - the song name has a box of at least 300px, on its own row,
 *    - a long name scrolls, a short one sits perfectly still,
 *    - nothing overflows the viewport horizontally,
 *    - with a bottom inset published the way MainActivity publishes it
 *      (--ember-inset-bottom on <html>), the bar and the nav both lift by it
 *      and leave the system buttons' strip empty; with none, nothing moves.
 *
 *  Needs the sandbox from tests/README.md and playwright-core. Set
 *  CHROME_PATH to pick a browser. */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.error('needs playwright-core: npm i -D playwright-core'); process.exit(2); }

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8091';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3010';
const PASSWORD = 'BugTest2026!';
const SHOTS = process.env.SHOT_DIR ?? '';

// Android's three-button navigation bar is 48dp: the inset the real phone
// publishes, and the one this test publishes the same way.
const INSET_PX = 48;
// Wider than any phone's title box, and comfortably narrower than it.
const LONG_TITLE = 'A Very Long Song Title That Cannot Possibly Fit On One Phone Line';
const SHORT_TITLE = 'Short One';

// The exact JavaScript MainActivity injects into the WebView for a 48dp
// navigation bar (apps/mobile/android/.../SafeAreaInsets.kt). Its Kotlin
// test asserts script(0, 0, 48, 0) is byte-for-byte this, so the two halves
// of the fix cannot drift apart.
const NATIVE_INSET_SCRIPT =
  "(function(){var v={'--ember-inset-top':'0px','--ember-inset-right':'0px','--ember-inset-bottom':'48px','--ember-inset-left':'0px'};function a(){var e=document.documentElement;if(!e)return false;for(var k in v)e.style.setProperty(k,v[k]);return true;}if(!a())document.addEventListener('readystatechange',a);})();";

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
    const r = await fetch(`${PB_URL}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: 'admin@ember.com', password: 'egKa5WNMx3QpuG7' }) });
    if (r.ok) return (await r.json()).token;
  }
  throw new Error('could not authenticate as PB admin');
}

/** A few seconds of a 440Hz tone, so the seeded tracks are real audio. */
function wav(seconds = 30, rate = 8000) {
  const n = seconds * rate;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const token = await adminToken();
const email = `mobileplayer-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
const created = await fetch(`${PB_URL}/api/collections/users/records`, { method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: token },
  body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name: 'Bar Tester', verified: true }) });
if (!created.ok) throw new Error(`could not create test user: ${created.status}`);
const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PASSWORD }) })
  .then((r) => r.json());
const cookie = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));

// Short enough a suffix that the short title stays short.
const stamp = Date.now().toString(36).slice(-4);
const titles = { long: `${LONG_TITLE} ${stamp}`, short: `${SHORT_TITLE} ${stamp}` };
for (const title of [titles.long, titles.short]) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(wav())], { type: 'audio/wav' }), 'a.wav');
  form.append('title', title);
  form.append('artist', 'Bar Tester');
  const r = await fetch(`${APP_URL}/api/uploads`, { method: 'POST', body: form, headers: { cookie: `pb_auth=${cookie}` } });
  if (!r.ok) throw new Error(`seed failed ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

const checks = [];
const check = (name, pass, detail = '') => { checks.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  : ${detail}` : ''}`); };

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const pageErrors = [];

/** Everything the bar is measured on, in one pass in the page. */
function measure() {
  const bar = document.querySelector('[data-testid="phone-player-bar"]');
  if (!bar) return null;
  // The bar is inside the one <footer> that carries the strip's chrome and
  // the safe-area stand-off (PLAYER_BAR_CHROME).
  const footer = bar.closest('footer');
  const nav = document.querySelector('[data-testid="mobile-nav"]');
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) }; };
  const control = (label) => {
    const el = bar.querySelector(`[aria-label="${label}"]`);
    return el ? rect(el) : null;
  };
  const marquee = bar.querySelector('[data-testid="marquee"]');
  const track = marquee && marquee.querySelector('[data-testid="marquee-track"]');
  return {
    bar: rect(footer),
    barPadBottom: Math.round(parseFloat(getComputedStyle(footer).paddingBottom)),
    navPadBottom: nav ? Math.round(parseFloat(getComputedStyle(nav).paddingBottom)) : null,
    nav: nav ? rect(nav) : null,
    titleRow: rect(bar.querySelector('[data-testid="phone-player-title-row"]')),
    controlsRow: rect(bar.querySelector('[data-testid="phone-player-controls-row"]')),
    marquee: marquee ? rect(marquee) : null,
    copies: track ? track.children.length : 0,
    animation: track ? getComputedStyle(track).animationName : 'none',
    transform: track ? getComputedStyle(track).transform : 'none',
    artwork: bar.querySelector('.size-art-sm') ? rect(bar.querySelector('.size-art-sm')) : null,
    prev: control('Previous'),
    play: control('Pause') || control('Play'),
    next: control('Next'),
    queue: control('Queue'),
    docScrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    innerH: window.innerHeight,
  };
}

/** Play one of the seeded uploads and wait for the bar to show it. */
async function playTitle(page, title) {
  await page.goto(`${APP_URL}/library/uploads`, { waitUntil: 'networkidle' });
  const row = page.locator('[data-testid="track-row"]').filter({ hasText: title }).first();
  await row.waitFor({ timeout: 20_000 });
  await row.getByLabel('Play', { exact: true }).first().click();
  const bar = page.locator('[data-testid="phone-player-bar"]');
  await bar.waitFor({ timeout: 20_000 });
  await page.waitForFunction((wanted) => {
    const el = document.querySelector('[data-testid="phone-player-bar"] [data-testid="marquee-track"]');
    return !!el && el.firstElementChild?.textContent?.trim() === wanted;
  }, title, { timeout: 20_000 });
  // Let the first measure and the layout settle before reading anything.
  await page.waitForTimeout(800);
}

/** Publish a bottom inset the way MainActivity does on a real phone: the
 *  --ember-inset-bottom custom property on <html>, which globals.css folds
 *  into --safe-bottom with max(env(...), ...). */
const setInset = (page, px) => page.evaluate((v) => {
  if (v === null) document.documentElement.style.removeProperty('--ember-inset-bottom');
  else document.documentElement.style.setProperty('--ember-inset-bottom', v + 'px');
}, px);

for (const [w, h] of [[390, 844], [360, 740]]) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  await ctx.addCookies([{ name: 'pb_auth', value: cookie, domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${w}: ${e}`));
  const at = (s) => `${w}px: ${s}`;

  // ---- a long title -----------------------------------------------------
  await playTitle(page, titles.long);
  let m = await page.evaluate(measure);

  check(at('the bar draws two rows, the song name above the controls'),
    m.titleRow.y + m.titleRow.h <= m.controlsRow.y,
    `name row ends at ${m.titleRow.y + m.titleRow.h}, controls start at ${m.controlsRow.y}`);

  check(at('the song name gets a box of at least 300px'),
    m.marquee.w >= 300, `${m.marquee.w}px of ${w}`);

  check(at('the name row is the full width of the bar, less its padding'),
    m.titleRow.w === m.marquee.w && m.titleRow.w >= w - 40,
    `name row ${m.titleRow.w}px, marquee ${m.marquee.w}px`);

  for (const [label, min] of [['prev', 48], ['next', 48], ['queue', 48], ['artwork', 48]]) {
    const box = m[label];
    check(at(`${label} is at least ${min}px in both directions`),
      !!box && box.w >= min && box.h >= min, box ? `${box.w}x${box.h}` : 'missing');
  }
  check(at('play is at least 56px in both directions'),
    m.play.w >= 56 && m.play.h >= 56, `${m.play.w}x${m.play.h}`);

  check(at('nothing overflows the viewport horizontally'),
    m.docScrollW <= m.innerW, `scrollWidth ${m.docScrollW} vs ${m.innerW}`);
  check(at('the bar footer is inside the viewport'),
    m.bar.x >= 0 && m.bar.x + m.bar.w <= w, `${m.bar.x}..${m.bar.x + m.bar.w}`);

  // A long name scrolls: two copies, the marquee animation running, and the
  // track actually moving over a second.
  check(at('a long name is drawn as two copies and animates'),
    m.copies === 2 && m.animation === 'ember-marquee-loop', `${m.copies} copies, ${m.animation}`);
  const before = m.transform;
  await page.waitForTimeout(1200);
  const after = (await page.evaluate(measure)).transform;
  check(at('a long name is actually moving'), before !== after, `${before} -> ${after}`);

  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `phone-${w}-long.png`) });

  // ---- the safe-area lift ----------------------------------------------
  const noInset = await page.evaluate(measure);
  check(at('with no inset published, nothing is lifted'),
    noInset.barPadBottom === 0 && noInset.navPadBottom === 0,
    `bar ${noInset.barPadBottom}px, nav ${noInset.navPadBottom}px`);
  check(at('with no inset, the nav reaches the bottom of the viewport'),
    Math.abs(noInset.nav.bottom - noInset.innerH) <= 1,
    `nav bottom ${noInset.nav.bottom}, viewport ${noInset.innerH}`);

  await setInset(page, INSET_PX);
  await page.waitForTimeout(150);
  const lifted = await page.evaluate(measure);
  check(at(`the nav lifts its content by the ${INSET_PX}px inset`),
    lifted.navPadBottom === INSET_PX, `${lifted.navPadBottom}px`);
  check(at('the player bar carries the same inset'),
    lifted.barPadBottom === INSET_PX, `${lifted.barPadBottom}px`);
  check(at('the nav grows by exactly the inset, so its buttons move up'),
    lifted.nav.h === noInset.nav.h + INSET_PX,
    `${noInset.nav.h}px -> ${lifted.nav.h}px`);
  check(at('the controls row now sits clear of the system buttons strip'),
    lifted.controlsRow.bottom <= lifted.innerH - INSET_PX,
    `controls end at ${lifted.controlsRow.bottom}, strip starts at ${lifted.innerH - INSET_PX}`);
  check(at('the tap targets did not shrink to pay for the lift'),
    lifted.play.h >= 56 && lifted.prev.h >= 48 && lifted.queue.h >= 48,
    `play ${lifted.play.h}, prev ${lifted.prev.h}, queue ${lifted.queue.h}`);

  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `phone-${w}-long-inset.png`) });
  await setInset(page, null);

  // The native half, for real: the literal script MainActivity injects for a
  // 48dp navigation bar. SafeAreaInsets.script(0, 0, 48, 0) is pinned to this
  // exact string by SafeAreaInsetsTest, so running it here proves the whole
  // contract end to end, short of the phone's own insets listener.
  await page.evaluate(NATIVE_INSET_SCRIPT);
  await page.waitForTimeout(150);
  const native = await page.evaluate(measure);
  check(at("the script MainActivity injects lifts the bar and the nav"),
    native.barPadBottom === INSET_PX && native.navPadBottom === INSET_PX,
    `bar ${native.barPadBottom}px, nav ${native.navPadBottom}px`);
  await page.evaluate(() => {
    for (const k of ['top', 'right', 'bottom', 'left']) {
      document.documentElement.style.removeProperty(`--ember-inset-${k}`);
    }
  });

  // ---- a short title ----------------------------------------------------
  await playTitle(page, titles.short);
  m = await page.evaluate(measure);
  check(at('a short name is one copy and never animates'),
    m.copies === 1 && m.animation === 'none', `${m.copies} copies, ${m.animation}`);
  const stillA = m.transform;
  await page.waitForTimeout(1200);
  const stillB = (await page.evaluate(measure)).transform;
  check(at('a short name is perfectly still'), stillA === stillB, `${stillA} -> ${stillB}`);
  check(at('the short name still gets the full-width box'), m.marquee.w >= 300, `${m.marquee.w}px`);
  check(at('nothing overflows horizontally with a short name'),
    m.docScrollW <= m.innerW, `scrollWidth ${m.docScrollW} vs ${m.innerW}`);

  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `phone-${w}-short.png`) });

  await ctx.close();
}

check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();

const failed = checks.filter((p) => !p).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
