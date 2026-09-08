/** The privacy switches on Settings → Profile.
 *
 *      node tests/toggles-ui.test.mjs      # or: npm run test:toggles
 *
 *  Reported as "the toggle buttons look off". The thumb is absolutely
 *  positioned with no `left`, so it fell back to its STATIC position — and a
 *  <button> centres its content, which put the origin at the middle of the
 *  44px track. The translate then added 22px more, so the thumb sat outside
 *  the pill entirely when on, and at the right-hand end when off: the switch
 *  read as "on" in both states.
 *
 *  The invariant worth holding: the thumb stays inside the track, and the two
 *  states are visibly different.
 *
 *  Needs the sandbox from tests/README.md (PB 8091, app 3010) and
 *  playwright-core. Set CHROME_PATH to pick a browser. */
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

async function adminToken() {
  // PocketBase renamed this collection; try both so the suite spans versions.
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const r = await fetch(PB + p, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: 'admin@ember.com', password: 'egKa5WNMx3QpuG7' }) });
    if (r.ok) return (await r.json()).token;
  }
  throw new Error('could not authenticate as PB admin');
}

const token = await adminToken();
const email = `toggle-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
const created = await fetch(`${PB}/api/collections/users/records`, { method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: token },
  body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name: 'Toggle Tester', verified: true }) });
if (!created.ok) throw new Error(`could not create test user: ${created.status}`);
const auth = await fetch(`${PB}/api/collections/users/auth-with-password`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: PASSWORD }) })
  .then((r) => r.json());
const cookie = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: 'pb_auth', value: cookie, domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

/** Geometry of every switch, measured the way a viewer sees it. */
const measure = () => page.evaluate(() =>
  [...document.querySelectorAll('[role="switch"]')].map((b) => {
    const track = b.getBoundingClientRect();
    const thumb = b.querySelector('span').getBoundingClientRect();
    return {
      label: (b.getAttribute('aria-label') ?? '').slice(0, 40),
      checked: b.getAttribute('aria-checked') === 'true',
      trackW: Math.round(track.width),
      offset: Math.round(thumb.left - track.left),
      spillLeft: Math.round(track.left - thumb.left),
      spillRight: Math.round(thumb.right - track.right),
    };
  }),
);

await page.goto(`${APP}/settings/profile`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

const initial = await measure();
check('A1 both privacy switches render', initial.length === 2, `${initial.length} found`);

// ── the reported bug ──────────────────────────────────────────────────────
for (const s of initial) {
  check(`B "${s.label.slice(0, 28)}" thumb sits inside the track`,
    s.spillRight <= 0 && s.spillLeft <= 0,
    `offset ${s.offset}px in a ${s.trackW}px track, spill R${s.spillRight} L${s.spillLeft}`);
}

// ── on and off must not look the same ─────────────────────────────────────
const first = page.locator('[role="switch"]').first();
const before = (await measure())[0];
await first.click();
await page.waitForTimeout(600);
const after = (await measure())[0];

check('C1 clicking flips the switch', before.checked !== after.checked,
  `${before.checked} -> ${after.checked}`);
check('C2 the two states are visibly different', before.offset !== after.offset,
  `thumb ${before.offset}px -> ${after.offset}px`);
check('C3 the thumb is still inside the track after flipping',
  after.spillRight <= 0 && after.spillLeft <= 0,
  `offset ${after.offset}px, spill R${after.spillRight}`);
check('C4 the OFF state keeps the thumb on the left half',
  (after.checked ? before : after).offset < (after.checked ? before : after).trackW / 2,
  `off-state offset ${(after.checked ? before : after).offset}px`);

// The change must survive a reload, otherwise the switch is a lie.
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const reloaded = (await measure())[0];
check('D1 the new state persisted', reloaded.checked === after.checked,
  `${after.checked} -> ${reloaded.checked}`);

await browser.close();

const failed = checks.filter(([, p]) => !p);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) console.log('FAILED:', failed.map(([n]) => n).join(', '));
process.exit(failed.length ? 1 : 0);
