/** QR sign-in end to end, in a real browser (plan Task 6).
 *
 *      PB_BIN=/path/to/pocketbase node tests/qr-login-ui.test.mjs
 *      SKIP_BUILD=1 ...   # reuse apps/web/.next from an earlier run
 *
 *  Everything it needs it starts itself, from this checkout, and stops at
 *  the end: a throwaway PocketBase on PB_PORT (default 8181) with a temp data
 *  dir and a made-up superuser, and the app built with POCKETBASE_URL
 *  pointing at it, served on APP_PORT (default 3181). Never the sandbox or
 *  live data. Bug reports go to a dead local address.
 *
 *  Context A is a phone signed in with a password; B is a new device on
 *  /auth. A opens B's QR link, sees B's device and "Same network", approves
 *  after the 2 s guard; B lands signed in as A. The link again finds
 *  nothing. A fresh request typed in Settings > Devices and declined shows
 *  declined on the device. Sign out everywhere on A signs B out. With
 *  QR_LOGIN_TTL_S=3 the device renews quietly 5 times, then shows "Code
 *  expired" and Get a new code works. Throughout: the poll cookie is
 *  httpOnly, a third browser cannot use the link, a signed-out scan keeps the
 *  token out of every URL across the sign-in, /pb/api/ember is a 404,
 *  and no token, code, poll secret or minted session reaches a log. */
import { execSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('This test needs playwright-core:\n\n  npm i -D playwright-core\n');
  process.exit(2);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'apps/web');
const PB_BIN = process.env.PB_BIN ?? path.join(ROOT, 'pocketbase', 'pocketbase');
const PB_PORT = Number(process.env.PB_PORT ?? 8181);
const APP_PORT = Number(process.env.APP_PORT ?? 3181);
const PB = `http://127.0.0.1:${PB_PORT}`;
const APP = `http://127.0.0.1:${APP_PORT}`;
const SU_EMAIL = 'qr-ui-su@qr.test';
const SU_PASSWORD = 'Qr-Ui-Superuser-2026';
const A_EMAIL = 'robin@qr.test';
const A_PASSWORD = 'Qr-Ui-Member-2026';
const A_NAME = 'Robin QR';

if (!fs.existsSync(PB_BIN)) {
  console.error(`No PocketBase binary at ${PB_BIN}; set PB_BIN.`);
  process.exit(2);
}
for (const url of [`${PB}/api/health`, `${APP}/auth`]) {
  if (await fetch(url).then(() => true, () => false)) {
    console.error(`Something is already listening for ${url}; this test starts its own servers there.`);
    process.exit(2);
  }
}

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-qr-ui-'));
const LOG_DIR = path.join(SB, 'logs');
fs.mkdirSync(LOG_DIR);
fs.mkdirSync(path.join(SB, 'music'));
const EMPTY_HOOKS = path.join(SB, 'empty-hooks');
fs.mkdirSync(EMPTY_HOOKS);

const out = [];
const check = (name, pass, detail = '') => {
  out.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Every credential seen during the run, for the log check at the end. */
const secrets = new Set();

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

const CRED_VARS = ['EMBER_PB_SUPERUSER_EMAIL', 'EMBER_PB_SUPERUSER_PASSWORD', 'EMBER_ADMIN_EMAIL', 'EMBER_ADMIN_PASSWORD',
  'POCKETBASE_ADMIN_EMAIL', 'POCKETBASE_ADMIN_PASSWORD', 'POCKETBASE_URL', 'NEXT_PUBLIC_POCKETBASE_URL', 'QR_LOGIN_TTL_S', 'PUBLIC_ORIGIN'];
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of CRED_VARS) delete env[k];
  return { ...env, ...extra };
}

// ── The throwaway PocketBase ──
let pbProc = null;
async function startPb() {
  const dir = path.join(SB, 'pb_data');
  const r = spawnSync(PB_BIN, ['migrate', 'up', `--dir=${dir}`, `--migrationsDir=${path.join(ROOT, 'pocketbase/pb_migrations')}`, `--hooksDir=${EMPTY_HOOKS}`],
    { encoding: 'utf8', env: cleanEnv() });
  if (r.status !== 0) throw new Error(`migrate up failed: ${r.stderr || r.stdout}`);
  pbProc = spawn(PB_BIN, ['serve', `--http=127.0.0.1:${PB_PORT}`, `--dir=${dir}`, `--hooksDir=${path.join(ROOT, 'pocketbase/pb_hooks')}`,
    `--migrationsDir=${path.join(ROOT, 'pocketbase/pb_migrations')}`, '--automigrate=0'], {
    env: cleanEnv({ EMBER_PB_SUPERUSER_EMAIL: SU_EMAIL, EMBER_PB_SUPERUSER_PASSWORD: SU_PASSWORD }),
    stdio: ['ignore', fs.openSync(path.join(SB, 'pb.log'), 'a'), fs.openSync(path.join(SB, 'pb.log'), 'a')],
  });
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${PB}/api/health`).then((x) => x.ok, () => false)) return;
    await sleep(200);
  }
  throw new Error(`PocketBase did not start, see ${SB}/pb.log`);
}

// ── The app, built from this checkout against that PocketBase ──
let appProc = null;
function appEnv(extra = {}) {
  return cleanEnv({
    POCKETBASE_URL: PB,
    POCKETBASE_ADMIN_EMAIL: SU_EMAIL,
    POCKETBASE_ADMIN_PASSWORD: SU_PASSWORD,
    EMBER_LOG_DIR: LOG_DIR,
    MUSIC_DIR: path.join(SB, 'music'),
    DISCORD_BUG_REPORT_WEBHOOK_URL: 'http://127.0.0.1:1/none',
    CLEANUP_DISABLED: '1',
    IMPORT_RUNNER_DISABLED: '1',
    ...extra,
  });
}
function build() {
  if (process.env.SKIP_BUILD === '1') return;
  console.log('building apps/web against the test PocketBase (a few minutes)...');
  // webpack: Turbopack refuses apps/web/node_modules when it is a symlink
  // out of the checkout (the worktree setup).
  const r = spawnSync('npx', ['next', 'build', '--webpack'], { cwd: WEB, env: appEnv(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  fs.writeFileSync(path.join(SB, 'build.log'), (r.stdout ?? '') + (r.stderr ?? ''));
  if (r.status !== 0) throw new Error(`next build failed, see ${SB}/build.log`);
}
async function startApp(extra = {}) {
  appProc = spawn('npx', ['next', 'start', '-p', String(APP_PORT), '-H', '127.0.0.1'], {
    cwd: WEB,
    detached: true,
    env: appEnv(extra),
    stdio: ['ignore', fs.openSync(path.join(SB, 'app.log'), 'a'), fs.openSync(path.join(SB, 'app.log'), 'a')],
  });
  for (let i = 0; i < 160; i++) {
    if (await fetch(`${APP}/auth`).then((x) => x.ok, () => false)) return;
    await sleep(250);
  }
  throw new Error(`the app did not start on :${APP_PORT}, see ${SB}/app.log`);
}
async function stopApp() {
  if (!appProc) return;
  try {
    process.kill(-appProc.pid, 'SIGKILL');
  } catch {
    // already gone
  }
  appProc = null;
  for (let i = 0; i < 40 && (await fetch(`${APP}/auth`).then(() => true, () => false)); i++) await sleep(250);
}
async function stopPb() {
  if (!pbProc) return;
  pbProc.kill('SIGTERM');
  await Promise.race([new Promise((r) => pbProc.on('exit', r)), sleep(8000)]);
  if (pbProc.exitCode === null) pbProc.kill('SIGKILL');
  pbProc = null;
}

const pbJson = (method, p, { token, body } = {}) =>
  fetch(PB + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

/** A new device: its own browser context on /auth, with every start
 *  response it gets recorded. */
async function newDevice(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const starts = [];
  page.on('response', async (res) => {
    if (res.url().endsWith('/api/auth/qr/start') && res.request().method() === 'POST') {
      const body = await res.json().catch(() => null);
      if (body) {
        starts.push(body);
        secrets.add(body.code);
        secrets.add(String(body.approveUrl).split('/link/')[1]);
      }
    }
  });
  await page.goto(`${APP}/auth`);
  await page.getByTestId('qr-code').waitFor({ timeout: 30_000 });
  return { ctx, page, starts };
}
async function pollCookie(ctx) {
  // No URL filter: the cookie's path is /api/auth/qr, not /.
  return (await ctx.cookies()).find((c) => c.name.startsWith('ember_qr_')) ?? null;
}
/** The link the QR holds, on this test's own origin. */
function linkOn(approveUrl) {
  const u = new URL(approveUrl);
  return `${APP}${u.pathname}`;
}

let browser = null;
try {
  await startPb();
  const su = (await pbJson('POST', '/api/admins/auth-with-password', { body: { identity: SU_EMAIL, password: SU_PASSWORD } })).body?.token;
  if (!su) throw new Error('the test superuser could not sign in');
  // A member, invited the normal way.
  await pbJson('POST', '/api/collections/allowed_emails/records', { token: su, body: { email: A_EMAIL } });
  const made = await pbJson('POST', '/api/collections/users/records', {
    token: su, body: { email: A_EMAIL, password: A_PASSWORD, passwordConfirm: A_PASSWORD, name: A_NAME, verified: true },
  });
  if (made.status !== 200) throw new Error(`could not create the member: ${JSON.stringify(made.body)}`);

  build();
  await startApp();
  browser = await chromium.launch({ executablePath: findChrome(), headless: true });

  // ── A signs in with a password, the way a phone would ──
  const aCtx = await browser.newContext({ viewport: { width: 400, height: 860 } });
  const a = await aCtx.newPage();
  await a.goto(`${APP}/auth`);
  await a.getByLabel('Email').fill(A_EMAIL);
  await a.getByRole('button', { name: 'Continue' }).click();
  await a.getByLabel('Password').fill(A_PASSWORD);
  await a.getByRole('button', { name: 'Log in' }).click();
  await a.waitForURL(`${APP}/`, { timeout: 30_000 });
  check('A0 A signs in with the password', true);

  // ── B, a new device, shows a QR and a code ──
  const b = await newDevice(browser);
  const bStart = b.starts.at(-1);
  const shownCode = (await b.page.getByTestId('qr-code').textContent()).trim();
  check('B1 /auth shows the QR and the grouped code', /^[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(shownCode) && shownCode.replace('-', '') === bStart?.code &&
    (await b.page.getByTestId('qr').count()) === 1, shownCode);
  const bDevice = (await b.page.getByText(/^This device: /).textContent()).replace('This device: ', '').trim();
  const bCookie = await pollCookie(b.ctx);
  if (bCookie) secrets.add(bCookie.value);
  check('B2 the poll secret is an httpOnly cookie of its own request, scoped to the QR routes', !!bCookie && bCookie.name === `ember_qr_${bStart.id}` && bCookie.httpOnly && bCookie.path === '/api/auth/qr' && bCookie.sameSite === 'Lax',
    JSON.stringify(bCookie && { httpOnly: bCookie.httpOnly, path: bCookie.path, sameSite: bCookie.sameSite }));
  check('B3 the token is only in the QR, never in the page text', !(await b.page.content()).includes(String(bStart.approveUrl).split('/link/')[1]));
  const link = linkOn(bStart.approveUrl);
  check('B4 the link points at this server', new URL(bStart.approveUrl).port === String(APP_PORT), bStart.approveUrl);

  // ── A third browser that only photographed the QR gets nothing ──
  const cCtx = await browser.newContext();
  const c = await cCtx.newPage();
  await c.goto(link);
  const tokenB = String(bStart.approveUrl).split('/link/')[1];
  const cUrl = new URL(c.url());
  check('C1 a signed-out browser opening the link is sent to sign in, with no token in the URL', cUrl.pathname === '/auth' &&
    cUrl.searchParams.get('next') === '/link' && !c.url().includes(tokenB), c.url());
  const stash = (await cCtx.cookies()).find((x) => x.name === 'ember_link');
  check('C1b the token waits in a short httpOnly cookie only /link sees', !!stash && stash.httpOnly && stash.path === '/link');
  const cStatus = await c.request.get(`${APP}/api/auth/qr/status`);
  check('C2 without the poll cookie the status route says nothing', cStatus.status() === 404);
  const cMint = await c.request.post(`${APP}/pb/api/ember/qr-login/mint`, { data: { user: 'x' } });
  check('C3 /pb/api/ember/qr-login/mint is a 404 through the app', cMint.status() === 404, String(cMint.status()));
  // That browser signs in (as A, the only member here) and lands on the
  // card, still with no token in any URL.
  await c.getByLabel('Email').fill(A_EMAIL);
  await c.getByRole('button', { name: 'Continue' }).click();
  await c.getByLabel('Password').fill(A_PASSWORD);
  await c.getByRole('button', { name: 'Log in' }).click();
  await c.getByTestId('approve-card').waitFor({ timeout: 30_000 });
  const cCard = await c.getByTestId('approve-card').textContent();
  check('C4 after sign-in it lands on /link with the card for that request, the token never in a URL', c.url() === `${APP}/link` &&
    cCard.includes(bDevice) && !c.url().includes(tokenB), c.url());
  check('C5 and the stashed cookie is gone once the card has used it', !(await cCtx.cookies()).some((x) => x.name === 'ember_link'));
  await cCtx.close();

  // ── A approves ──
  await a.goto(link);
  const card = a.getByTestId('approve-card');
  await card.waitFor({ timeout: 20_000 });
  check('A1 the token leaves the address bar', new URL(a.url()).pathname === '/link', a.url());
  const cardText = await card.textContent();
  check('A2 the card names the device, the network and the account', cardText.includes(bDevice) && cardText.includes('Same network as this phone') &&
    cardText.includes(`Says it is: ${bDevice}`) && cardText.includes(A_EMAIL) && !cardText.includes(bStart.code), cardText);
  const approveBtn = a.getByRole('button', { name: 'Approve' });
  check('A3 Approve is disabled at first', await approveBtn.isDisabled());
  await a.waitForTimeout(2200);
  await approveBtn.click();
  await a.getByText('Done. The other device is signing in.').waitFor({ timeout: 10_000 });
  check('A4 approving says done', true);

  await b.page.getByText(`Signed in as ${A_NAME}`).waitFor({ timeout: 15_000 });
  check('B5 the new device says whose account it signed in as', true);
  await b.page.waitForURL(`${APP}/`, { timeout: 15_000 });
  const bAuth = (await b.ctx.cookies(APP)).find((x) => x.name === 'pb_auth');
  let bToken = null;
  try {
    bToken = JSON.parse(decodeURIComponent(bAuth.value)).token;
    secrets.add(bToken);
  } catch {
    bToken = null;
  }
  const recentB = await b.page.request.get(`${APP}/api/auth/qr/recent`);
  check('B6 the new device is signed in as A', !!bToken && recentB.status() === 200 && (await recentB.json()).signIns.length === 1);
  check('B7 the poll cookie is gone after delivery', !(await pollCookie(b.ctx)));

  await a.goto(link);
  await a.getByText('This code has expired or was already used. Ask the device for a new one.').waitFor({ timeout: 10_000 });
  check('A5 the same link again finds nothing to approve', (await a.getByTestId('approve-card').count()) === 0);

  // ── A fresh request, typed in Settings > Devices, declined ──
  const b2 = await newDevice(browser);
  const code2 = b2.starts.at(-1).code;
  await a.goto(`${APP}/settings/devices`);
  await a.getByLabel('Code').fill(`${code2.slice(0, 4).toLowerCase()}-${code2.slice(4)}`);
  await a.getByRole('button', { name: 'Continue' }).click();
  await a.getByTestId('approve-card').waitFor({ timeout: 10_000 });
  await a.getByRole('button', { name: 'Not me' }).click();
  await a.getByText('Declined.').waitFor({ timeout: 10_000 });
  await b2.page.getByText('Sign-in was declined on your other device.').waitFor({ timeout: 15_000 });
  check('D1 Not me from the typed code shows declined on the device', true);
  await b2.ctx.close();

  // ── Sign out everywhere ──
  await a.goto(`${APP}/settings/devices`);
  await a.getByText(bDevice).first().waitFor({ timeout: 10_000 });
  check('E1 Recent sign-ins lists the new device', true);
  await a.getByRole('button', { name: 'Sign out everywhere' }).click();
  await a.getByRole('button', { name: 'Yes, sign out everywhere' }).click();
  await a.waitForURL(/\/auth/, { timeout: 15_000 });
  check('E2 Sign out everywhere signs this device out', true);
  await b.page.goto(`${APP}/library`);
  await b.page.waitForURL(/\/auth/, { timeout: 15_000 });
  check('E3 and the QR-signed-in device is signed out on its next request', new URL(b.page.url()).pathname === '/auth', b.page.url());
  const dead = await pbJson('POST', '/api/collections/users/auth-refresh', { token: bToken });
  check('E4 PocketBase itself refuses the minted token now', dead.status === 401, String(dead.status));
  await b.ctx.close();
  await aCtx.close();

  // ── Expiry: a 3 s code renews quietly 5 times, then asks ──
  await stopApp();
  await startApp({ QR_LOGIN_TTL_S: '3' });
  const b3 = await newDevice(browser);
  await b3.page.getByText('Code expired').waitFor({ timeout: 90_000 });
  check('F1 after 5 quiet renewals the device says Code expired', b3.starts.length === 6, `${b3.starts.length} requests`);
  await b3.page.getByRole('button', { name: 'Get a new code' }).click();
  await b3.page.getByTestId('qr-code').waitFor({ timeout: 10_000 });
  check('F2 Get a new code starts a new request', b3.starts.length === 7, `${b3.starts.length} requests`);
  for (const s of b3.starts) secrets.add(s.code);
  await b3.ctx.close();
} catch (e) {
  check('the run finished', false, e instanceof Error ? e.stack : String(e));
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopApp();
  await stopPb();
}

// ── No credential in any log ──
{
  const texts = [];
  for (const f of fs.readdirSync(LOG_DIR)) texts.push(fs.readFileSync(path.join(LOG_DIR, f), 'utf8'));
  for (const f of ['app.log', 'pb.log']) if (fs.existsSync(path.join(SB, f))) texts.push(fs.readFileSync(path.join(SB, f), 'utf8'));
  const all = texts.join('\n');
  const leaked = [...secrets].filter((s) => s && s.length >= 8 && all.includes(s));
  check('L1 no token, code, poll secret or minted session in the server or app logs', secrets.size > 4 && leaked.length === 0,
    `${secrets.size} secrets checked, ${leaked.length} leaked`);
  check('L2 the audit lines are there', /qr approved/.test(all) && /qr delivered/.test(all) && /qr denied/.test(all));
}

const failed = out.filter((x) => !x.pass);
if (failed.length) console.log(`logs kept in ${SB}`);
else fs.rmSync(SB, { recursive: true, force: true });
console.log(`\n${out.length - failed.length}/${out.length} passed`);
process.exit(failed.length ? 1 : 0);
