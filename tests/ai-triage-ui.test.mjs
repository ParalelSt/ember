/** UI check for the bug-report triage panel.
 *
 *  Submits a real report as a logged-in user in a headless browser and
 *  confirms the diagnosis renders, the panel resets, and the page logs no
 *  console errors. Requires the same sandbox as ai-triage.test.mjs plus a
 *  fake Anthropic on FAKE_ANTHROPIC_PORT — start one with:
 *
 *      node tests/fake-anthropic.mjs &
 *      node tests/ai-triage-ui.test.mjs
 *
 *  Browser: uses Playwright's bundled Chromium. Set CHROME_PATH to override.
 *  Each run creates a throwaway user, so the 30s report cooldown never bites.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// playwright-core isn't a repo dependency (the app doesn't need it) — install
// it on demand rather than making everyone carry a browser driver.
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('This test needs playwright-core:\n\n  npm i -D playwright-core\n');
  process.exit(2);
}

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8091';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3005';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL ?? 'admin@ember.com';
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD ?? 'egKa5WNMx3QpuG7';

/** Playwright's cache layout differs per platform/version; find any Chromium
 *  it has downloaded rather than hard-coding one. */
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = path.join(process.env.HOME ?? '', 'Library/Caches/ms-playwright');
  if (!fs.existsSync(root)) throw new Error('no Playwright browser cache — set CHROME_PATH');
  const dirs = fs.readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse();
  for (const d of dirs) {
    const found = execSync(
      `find "${path.join(root, d)}" -maxdepth 6 -type f \\( -name "Google Chrome for Testing" -o -name "Chromium" \\) 2>/dev/null | head -1`,
      { encoding: 'utf8' },
    ).trim();
    if (found) return found;
  }
  throw new Error('no Chromium binary found — set CHROME_PATH');
}

async function adminToken() {
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const res = await fetch(`${PB_URL}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: PB_ADMIN_EMAIL, password: PB_ADMIN_PASSWORD }),
    });
    if (res.ok) return (await res.json()).token;
  }
  throw new Error('could not authenticate as PB admin');
}

// Throwaway user, unique per run.
const email = `uitest-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
const password = 'BugTest2026!';
const token = await adminToken();
const created = await fetch(`${PB_URL}/api/collections/users/records`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: token },
  body: JSON.stringify({ email, password, passwordConfirm: password, name: 'UI Tester', verified: true }),
});
if (!created.ok) throw new Error(`could not create test user: ${created.status}`);
const userId = (await created.json()).id;

const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identity: email, password }),
}).then((r) => r.json());
const cookie = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
await ctx.addCookies([{ name: 'pb_auth', value: cookie, domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

await page.goto(`${APP_URL}/settings/help`, { waitUntil: 'networkidle' });

const reportBtn = page.getByRole('button', { name: /report a bug/i }).first();
await reportBtn.waitFor({ timeout: 15_000 });
await reportBtn.click();

const textarea = page.locator('textarea').first();
await textarea.waitFor({ timeout: 10_000 });
await textarea.fill('Songs cut out a few seconds in, every time');
await page.getByRole('button', { name: /send report/i }).click();

await page.getByRole('heading', { name: /Report sent/i }).waitFor({ timeout: 30_000 });
// The lyrics sheet is also a dialog in the DOM — scope to ours.
const body = await page.locator('[role="dialog"]').filter({ hasText: 'Report sent' }).first().innerText();

const checks = [
  ['title switches to "Report sent"', /Report sent/i.test(body)],
  ['severity badge shown', /high/i.test(body)],
  ['area badge shown', /streaming/i.test(body)],
  ['confidence shown', /confidence/i.test(body)],
  ['summary rendered', /Playback stops a few seconds/i.test(body)],
  ['likely cause rendered', /403/.test(body)],
  ['next steps rendered', /yt-dlp/i.test(body)],
  ['honesty caveat present', /automated guess/i.test(body)],
];

await page.getByRole('button', { name: /^done$/i }).click();
await page.waitForTimeout(500);
checks.push(['Done closes the result panel',
  (await page.getByRole('heading', { name: /Report sent/i }).count()) === 0]);

await reportBtn.click();
await page.locator('textarea').first().waitFor({ timeout: 10_000 });
checks.push(['reopens on the form, not the stale result',
  (await page.locator('textarea[placeholder*="What happened"]').count()) === 1]);
checks.push(['note field cleared for the next report',
  (await page.locator('textarea').first().inputValue()) === '']);
checks.push(['no console errors', consoleErrors.length === 0]);

for (const [name, pass] of checks) console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
if (consoleErrors.length) console.log('console errors:', consoleErrors.slice(0, 5));
const failed = checks.filter(([, p]) => !p);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);

await browser.close();
// Clean up the throwaway user.
await fetch(`${PB_URL}/api/collections/users/records/${userId}`, {
  method: 'DELETE',
  headers: { Authorization: token },
}).catch(() => {});

process.exit(failed.length ? 1 : 0);
