/** The song title in the full-screen phone player sits still or scrolls, and
 *  never strobes.
 *
 *      node tests/marquee-ui.test.mjs      # or: npm run test:marquee-ui
 *
 *  Reported as: "the title text flickers and it's mumbled". The cause was a
 *  design-system spacing token, `--spacing-block`, whose name completes one
 *  of Tailwind 4's own utility names: it generated a second
 *  `.inline-block { inline-size: 1rem }` rule, emitted after the core
 *  `display: inline-block` one at the same specificity. Every `inline-block`
 *  element in the app was pinned to 16px wide, so the marquee's two copies
 *  of the title became two 16px boxes with 215px of text spilling out of
 *  each, sliding over one another: unreadable, and it looked like flicker.
 *
 *  This drives a real Chromium tab at a phone viewport, seeds one long and
 *  one short uploaded title, opens the full-screen player on each and
 *  samples the title for three seconds. The invariants:
 *
 *    - the title's box never changes size or moves (no measure/render loop),
 *    - the number of rendered copies never changes (no animated/static flip),
 *    - each copy is drawn at the title's own natural width, so the text is
 *      never squashed into a box narrower than itself,
 *    - a long title holds still through its start delay and then moves,
 *    - a short title renders one copy and never animates at all.
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

// A title comfortably wider than a 390px phone's title box, and one
// comfortably narrower. Neither sits near the threshold on purpose: the
// threshold itself is covered by the unit tests
// (apps/web/components/player/MarqueeText.test.tsx).
const LONG_TITLE = 'A Very Long Song Title That Cannot Possibly Fit On One Phone Line';
const SHORT_TITLE = 'Short One';

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
function wav(seconds = 20, rate = 8000) {
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
const email = `marquee-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
const created = await fetch(`${PB_URL}/api/collections/users/records`, { method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: token },
  body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name: 'Marquee Tester', verified: true }) });
if (!created.ok) throw new Error(`could not create test user: ${created.status}`);
const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PASSWORD }) })
  .then((r) => r.json());
const cookie = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));

// Short enough a suffix that the short title stays short: a full timestamp
// would push it past the box and it would (correctly) start scrolling.
const stamp = Date.now().toString(36).slice(-4);
const titles = { long: `${LONG_TITLE} ${stamp}`, short: `${SHORT_TITLE} ${stamp}` };
const uploadIds = [];
for (const title of [titles.long, titles.short]) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(wav())], { type: 'audio/wav' }), 'a.wav');
  form.append('title', title);
  form.append('artist', 'Marquee Tester');
  const r = await fetch(`${APP_URL}/api/uploads`, { method: 'POST', body: form, headers: { cookie: `pb_auth=${cookie}` } });
  if (!r.ok) throw new Error(`seed failed ${r.status}: ${(await r.text()).slice(0, 200)}`);
  uploadIds.push((await r.json()).track.sourceId);
}

const checks = [];
const check = (name, pass, detail = '') => { checks.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  : ${detail}` : ''}`); };

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
await ctx.addCookies([{ name: 'pb_auth', value: cookie, domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

/** Open the full-screen player on one of the seeded uploads. */
/** Open the full-screen player on one of the seeded uploads. The view is
 *  never unmounted, only translated off the bottom of the screen, so
 *  "is it open" has to be asked of where it actually sits: a plain
 *  visibility check says yes even when it is parked off-screen. Reloading
 *  the page closes it (the open flag is not persisted), which is what keeps
 *  the two rounds below independent of each other. */
// The phone player BAR now scrolls its own title too, so every lookup here
// has to say which marquee it means: the full-screen view's.
const NP_MARQUEE = '[data-testid="now-playing"] [data-testid="marquee"]';

/** Is the full-screen view actually on screen (not parked below it)? */
const playerIsOpen = () => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.top >= 0 && r.bottom <= window.innerHeight;
}, NP_MARQUEE);

/** Close it the way a phone does, and wait for it to be gone. Leaving it
 *  open across a navigation lets its own back-dismiss history entry fire
 *  after the next page has loaded and bounce the tab off it. */
async function closePlayer() {
  if (!(await playerIsOpen())) return;
  await page.getByRole('button', { name: 'Close' }).first().click();
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return !el || el.getBoundingClientRect().top >= window.innerHeight;
  }, NP_MARQUEE, { timeout: 10_000 });
  await page.waitForTimeout(400);
}

async function openPlayerFor(title) {
  await closePlayer();
  await page.goto(`${APP_URL}/library/uploads`, { waitUntil: 'networkidle' });
  const row = page.locator('[data-testid="track-row"]').filter({ hasText: title }).first();
  await row.waitFor({ timeout: 15_000 });
  // The row's own Play button, not the row body: tapping the row does not
  // reliably swap the playing track while something else is already going
  // (a separate known bug, not this one's business).
  await row.getByLabel('Play', { exact: true }).first().click();
  // The bar appears as soon as a track is current; tapping its song-name
  // row opens the full-screen view (phones only, which is the viewport we
  // are at). The row, not the text: the bar's own title is a marquee now,
  // and its measuring ruler is the first thing a text lookup finds.
  const bar = page.locator('[data-testid="phone-player-title-row"]');
  await bar.waitFor({ timeout: 15_000 });
  await bar.click();
  await page.waitForFunction(([wanted, sel]) => {
    const el = document.querySelector(sel);
    const copy = el && el.querySelector('[data-testid="marquee-track"]')?.firstElementChild;
    if (!copy || copy.textContent.trim() !== wanted) return false;
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight;
  }, [title, NP_MARQUEE], { timeout: 15_000 });
  // Let the open transition and the first measure settle before sampling.
  await page.waitForTimeout(700);
}

/** Sample the title element every `every` ms for `ms` ms. */
async function sample(ms, every = 100) {
  return page.evaluate(async ([total, step, sel]) => {
    const out = [];
    const el = document.querySelector(sel);
    const track = () => el.querySelector('[data-testid="marquee-track"]');
    for (let t = 0; t < total; t += step) {
      const r = el.getBoundingClientRect();
      const tr = track();
      out.push({
        box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(','),
        copies: tr.children.length,
        copyWidths: [...tr.children].map((c) => Math.round(c.getBoundingClientRect().width)).join(','),
        animation: getComputedStyle(tr).animationName,
        transform: getComputedStyle(tr).transform,
      });
      await new Promise((r2) => setTimeout(r2, step));
    }
    return out;
  }, [ms, every, NP_MARQUEE]);
}

const distinct = (rows, key) => [...new Set(rows.map((r) => r[key]))];

// ---- a long title -------------------------------------------------------
await openPlayerFor(titles.long);
const long = await sample(3000);

check('long title: the box never changes over 3s',
  distinct(long, 'box').length === 1, distinct(long, 'box').join(' | '));
check('long title: the number of copies never changes over 3s',
  distinct(long, 'copies').length === 1 && long[0].copies === 2, distinct(long, 'copies').join(' | '));
check('long title: both copies stay at one stable, identical width',
  distinct(long, 'copyWidths').length === 1, distinct(long, 'copyWidths').join(' | '));
check('long title: it is animating the marquee loop throughout',
  distinct(long, 'animation').length === 1 && long[0].animation === 'ember-marquee-loop',
  distinct(long, 'animation').join(' | '));

// The regression: each copy was squeezed to 16px with the full text spilling
// out of it, so the two copies painted on top of each other.
const [boxW] = [Number(long[0].box.split(',')[2])];
const copyW = long[0].copyWidths.split(',').map(Number);
check('long title: each copy is drawn at its own natural width, wider than the box',
  copyW.length === 2 && copyW[0] === copyW[1] && copyW[0] > boxW,
  `copies ${copyW.join(' and ')} px in a ${boxW}px box`);

// It holds still through the start delay, then moves. Sampling started ~700ms
// after the view opened, so the first few frames are still inside the 1s pause.
const movedEarly = distinct(long.slice(0, 2), 'transform').length;
const movedLater = distinct(long.slice(-8), 'transform').length;
check('long title: still during its start delay', movedEarly === 1, long[0].transform);
check('long title: scrolling by the end of the sample', movedLater > 1,
  `${movedLater} distinct transforms in the last 800ms`);

// ---- a short title ------------------------------------------------------
await openPlayerFor(titles.short);
const short = await sample(3000);

check('short title: the box never changes over 3s',
  distinct(short, 'box').length === 1, distinct(short, 'box').join(' | '));
check('short title: exactly one copy, always',
  distinct(short, 'copies').length === 1 && short[0].copies === 1, distinct(short, 'copies').join(' | '));
check('short title: never animates', short.every((r) => r.animation === 'none'),
  distinct(short, 'animation').join(' | '));
check('short title: perfectly still', distinct(short, 'transform').length === 1,
  distinct(short, 'transform').join(' | '));

check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();

// Leave the sandbox as it was: the uploads (record, file, cover) through the
// app's own DELETE, then the user.
for (const id of uploadIds) {
  await fetch(`${APP_URL}/api/uploads/${id}`, { method: 'DELETE', headers: { cookie: `pb_auth=${cookie}` } });
}
await fetch(`${PB_URL}/api/collections/users/records/${auth.record.id}`, { method: 'DELETE', headers: { Authorization: token } });

const failed = checks.filter((p) => !p).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
