/** UI check for "Send a request" (Settings > Help): pick New feature or Fix,
 *  fill the form, and confirm each kind reaches its own Discord webhook.
 *
 *      npm i -D playwright-core
 *      node tests/requests-ui.test.mjs      # or: npm run test:requests-ui
 *
 *  Starts its own tiny HTTP sink on :4321 (POST /feature, POST /fix) that
 *  records the last body it received per path: the server under test must
 *  be started with DISCORD_FEATURE_WEBHOOK_URL=http://127.0.0.1:4321/feature
 *  and DISCORD_FIX_WEBHOOK_URL=http://127.0.0.1:4321/fix (see tests/README.md).
 *  Set CHROME_PATH to pick a browser. */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('This test needs playwright-core:\n\n  npm i -D playwright-core\n');
  process.exit(2);
}

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8091';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3015';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL ?? 'admin@ember.com';
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD ?? 'egKa5WNMx3QpuG7';
const SINK_PORT = Number(process.env.REQUESTS_SINK_PORT ?? 4321);
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

// Records the last POST body per path so the test (a separate process from
// the app server) can inspect what the route actually sent.
const sinkBodies = { feature: null, fix: null };
const sink = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    if (req.url === '/feature') sinkBodies.feature = body;
    else if (req.url === '/fix') sinkBodies.fix = body;
    res.writeHead(204);
    res.end();
  });
});
await new Promise((resolve) => sink.listen(SINK_PORT, '127.0.0.1', resolve));

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

const token = await adminToken();
const email = `requests-uitest-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
const created = await fetch(`${PB_URL}/api/collections/users/records`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: token },
  body: JSON.stringify({ email, password: PASSWORD, passwordConfirm: PASSWORD, name: 'Requests UI Tester', verified: true }),
});
if (!created.ok) throw new Error(`could not create test user: ${created.status}`);
const userId = (await created.json()).id;
const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identity: email, password: PASSWORD }),
}).then((r) => r.json());
const cookie = encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record }));

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
await ctx.addCookies([{ name: 'pb_auth', value: cookie, domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` : ${detail}` : ''}`);
};

await page.goto(`${APP_URL}/settings/help`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /^send a request$/i }).click();
check('dialog opens', await page.getByRole('dialog').filter({ hasText: 'Send a request' }).count() > 0);

// --- Feature request ------------------------------------------------------
const featureName = `UI Feature ${Date.now()}`;
await page.getByPlaceholder('Short name, e.g. Sleep timer').fill(featureName);
await page
  .getByPlaceholder(/What should it do, and when would you use it/)
  .fill('So I can test this from a headless browser.');
await page.getByRole('button', { name: /^send$/i }).click();
await page.getByText(/thanks, request sent/i).first().waitFor({ timeout: 15_000 });
check('toast shown after feature send', true);

await new Promise((r) => setTimeout(r, 300));
const featureBody = sinkBodies.feature ? JSON.parse(sinkBodies.feature) : null;
check('feature sink received one embed', !!featureBody?.embeds?.[0]);
check('feature embed title carries the name', (featureBody?.embeds?.[0]?.title ?? '').includes(featureName), featureBody?.embeds?.[0]?.title);
check('fix sink untouched by the feature send', sinkBodies.fix === null);

// --- Fix request -----------------------------------------------------------
await page.getByRole('button', { name: /^send a request$/i }).click();
await page.getByRole('tab', { name: /^fix$/i }).click();
const fixName = `UI Fix ${Date.now()}`;
await page.getByPlaceholder(/What needs fixing/).fill(fixName);
await page.getByPlaceholder(/What happens now and what you'd expect instead/).fill('It should not do the broken thing.');
await page.getByRole('button', { name: /^send$/i }).click();
await page.getByText(/thanks, request sent/i).first().waitFor({ timeout: 15_000 });
check('toast shown after fix send', true);

await new Promise((r) => setTimeout(r, 300));
const fixBody = sinkBodies.fix ? JSON.parse(sinkBodies.fix) : null;
check('fix sink received one embed', !!fixBody?.embeds?.[0]);
check('fix embed title carries the name', (fixBody?.embeds?.[0]?.title ?? '').includes(fixName), fixBody?.embeds?.[0]?.title);

check('no console errors', consoleErrors.length === 0, consoleErrors[0] ?? '');

const failed = checks.filter(([, p]) => !p);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);

await browser.close();
sink.close();
await fetch(`${PB_URL}/api/collections/users/records/${userId}`, { method: 'DELETE', headers: { Authorization: token } }).catch(() => {});
process.exit(failed.length ? 1 : 0);
