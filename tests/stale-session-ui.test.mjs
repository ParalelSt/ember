/** A stale or revoked session must not fire signed-in calls (bughunt V5).
 *
 *      EMBER_PB_SUPERUSER_EMAIL=... EMBER_PB_SUPERUSER_PASSWORD=... \
 *      PB_URL=http://127.0.0.1:8084 APP_URL=http://127.0.0.1:3055 \
 *      node tests/stale-session-ui.test.mjs
 *
 *  A browser carries a pb_auth cookie whose token PocketBase refuses (the
 *  signature is wrong, the expiry is still in the future: what a revoked
 *  session or a reinstalled server looks like). Loading /auth, or a page that
 *  sends you there, must answer with zero 401s and zero automatic bug
 *  reports, and the dead cookie must be gone afterwards. Signing out with a
 *  song loaded must not keep asking for its lyrics. /privacy and /terms still
 *  load signed out (the /track share page is covered by proxy.test.ts, since
 *  rendering one asks YouTube), and a good session still works.
 *
 *  Needs a throwaway PocketBase started with this worktree's hooks and
 *  migrations (the EMBER_PB_SUPERUSER_* values make its superuser, bughunt
 *  W14) and the app built against it. Bug reports are answered in the browser
 *  and never reach the server; lyrics are stubbed, so nothing leaves the
 *  machine. Set CHROME_PATH to pick a browser. */
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

const PB = process.env.PB_URL ?? 'http://127.0.0.1:8084';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:3055';
const SU_EMAIL = process.env.EMBER_PB_SUPERUSER_EMAIL;
const SU_PASSWORD = process.env.EMBER_PB_SUPERUSER_PASSWORD;
const PW = 'BugTest2026!';
const SETTLE_MS = 6000; // longer than autoReport's 2 s debounce
if (!SU_EMAIL || !SU_PASSWORD) {
  console.error('Set EMBER_PB_SUPERUSER_EMAIL/_PASSWORD (the throwaway sandbox superuser).');
  process.exit(2);
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = path.join(process.env.HOME ?? '', 'Library/Caches/ms-playwright');
  if (!fs.existsSync(root)) throw new Error('no Playwright browser cache, set CHROME_PATH');
  for (const d of fs.readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    const found = execSync(
      `find "${path.join(root, d)}" -maxdepth 6 -type f \\( -name "Google Chrome for Testing" -o -name "Chromium" \\) 2>/dev/null | head -1`,
      { encoding: 'utf8' },
    ).trim();
    if (found) return found;
  }
  throw new Error('no Chromium binary found, set CHROME_PATH');
}

const out = [];
const check = (name, pass, detail = '') => {
  out.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

async function superToken() {
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const r = await fetch(PB + p, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: SU_EMAIL, password: SU_PASSWORD }),
    });
    if (r.ok) return (await r.json()).token;
  }
  throw new Error('superuser sign-in failed: check EMBER_PB_SUPERUSER_*');
}

async function member() {
  const tok = await superToken();
  const email = `stale-${Date.now()}-${Math.floor(Math.random() * 1e5)}@ember.test`;
  const made = await fetch(`${PB}/api/collections/users/records`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: tok },
    body: JSON.stringify({ email, password: PW, passwordConfirm: PW, name: 'Stale', verified: true }),
  });
  if (!made.ok) throw new Error(`could not create member: ${made.status}`);
  const auth = await fetch(`${PB}/api/collections/users/auth-with-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: email, password: PW }),
  }).then((r) => r.json());
  if (!auth.token) throw new Error('member sign-in failed');
  return auth;
}

const cookieValue = (token, record) => encodeURIComponent(JSON.stringify({ token, record }));

const TRACK = {
  id: 'youtube:v5stale0001', source: 'youtube', sourceId: 'v5stale0001', title: 'Stale Song',
  artist: 'The Nulls', artistId: null, album: null, albumId: null, durationSec: 30,
  artworkUrl: null, streamUrl: '',
};

/** A browser context carrying `cookie` (a pb_auth value or null) with its
 *  traffic tallied: 401s from the app, bug-report POSTs, lyrics requests. */
async function context(browser, cookie, { withTrack = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // Host-only, like the one the app writes, so the app's own clear replaces it.
  if (cookie) await ctx.addCookies([{ name: 'pb_auth', value: cookie, url: APP }]);
  await ctx.addInitScript((track) => {
    try {
      if (track && !sessionStorage.getItem('v5.seeded')) {
        sessionStorage.setItem('v5.seeded', '1');
        localStorage.setItem('ember.player.v1', JSON.stringify({
          state: { queue: [track], index: 0, position: 0, volume: 0, context: null, loopMode: 'off', baseCount: 1, muted: true },
          version: 0,
        }));
      }
    } catch {}
  }, withTrack ? TRACK : null);
  const tally = { unauthorized: [], reports: 0, lyrics: 0 };
  // Bug reports never reach the server: counted and answered here.
  await ctx.route('**/api/bug-report**', (r) => {
    if (r.request().method() === 'POST') tally.reports += 1;
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  // Lyrics never leave the machine either.
  await ctx.route('**/api/lyrics?**', (r) => {
    tally.lyrics += 1;
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"lyrics":null,"source":"none","url":null}' });
  });
  // The seeded song's stream: nothing to play, and no trip to YouTube.
  await ctx.route('**/api/youtube/stream/**', (r) => r.fulfill({ status: 404, body: '' }));
  const page = await ctx.newPage();
  page.on('response', (res) => {
    if (res.status() === 401 && res.url().startsWith(APP)) tally.unauthorized.push(res.url().replace(APP, '').replace(/\?.*/, ''));
  });
  return { ctx, page, tally };
}

const pbCookie = async (ctx) => (await ctx.cookies(APP)).find((c) => c.name === 'pb_auth' && c.value)?.value ?? null;
const settle = (page) => page.waitForTimeout(SETTLE_MS);
const summary = (t) => `401s ${t.unauthorized.length}${t.unauthorized.length ? ` [${[...new Set(t.unauthorized)].join(', ')}]` : ''}, reports ${t.reports}, lyrics ${t.lyrics}`;

const good = await member();
const [h, p] = good.token.split('.');
const bad = cookieValue(`${h}.${p}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`, good.record);
const browser = await chromium.launch({ executablePath: findChrome(), headless: true });

try {
  // V5a: a refused session straight onto /auth, with a song left in the player.
  {
    const { ctx, page, tally } = await context(browser, bad, { withTrack: true });
    await page.goto(`${APP}/auth`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    check('V5a /auth with a refused session: no 401s', tally.unauthorized.length === 0, summary(tally));
    check('V5a /auth with a refused session: no automatic bug reports', tally.reports === 0, summary(tally));
    check('V5a /auth with a refused session: no lyrics lookups', tally.lyrics === 0, summary(tally));
    check('V5a the refused cookie is cleared', (await pbCookie(ctx)) === null);
    await ctx.close();
  }

  // V5b: a signed-in page with the refused session lands on /auth quietly.
  {
    const { ctx, page, tally } = await context(browser, bad, { withTrack: true });
    await page.goto(`${APP}/library`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    const url = new URL(page.url());
    check('V5b /library with a refused session goes to sign in', url.pathname === '/auth', page.url().replace(APP, ''));
    check('V5b ... with no 401s and no automatic bug reports', tally.unauthorized.length === 0 && tally.reports === 0, summary(tally));
    await ctx.close();
  }

  // V5c: sign out with a song loaded: no more lyrics lookups, no 401s.
  {
    const { ctx, page, tally } = await context(browser, cookieValue(good.token, good.record), { withTrack: true });
    await page.goto(`${APP}/settings/profile`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000); // hydrated, so the button has its handler
    await page.getByRole('button', { name: 'Sign out' }).click({ timeout: 20000 });
    await page.waitForURL((u) => u.pathname === '/auth', { timeout: 20000 });
    const before = { lyrics: tally.lyrics, unauthorized: tally.unauthorized.length, reports: tally.reports };
    await settle(page);
    const after = { lyrics: tally.lyrics - before.lyrics, unauthorized: tally.unauthorized.length - before.unauthorized, reports: tally.reports - before.reports };
    check('V5c after sign-out: no lyrics lookups, 401s or reports', after.lyrics === 0 && after.unauthorized === 0 && after.reports === 0, JSON.stringify(after));
    check('V5c after sign-out: the cookie is gone', (await pbCookie(ctx)) === null);
    await ctx.close();
  }

  // Public pages load signed out and with a refused session.
  for (const [label, cookie] of [['signed out', null], ['refused session', bad]]) {
    const { ctx, page, tally } = await context(browser, cookie);
    for (const route of ['/privacy', '/terms']) {
      const res = await page.goto(`${APP}${route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      check(`P ${route} loads ${label}`, res?.status() === 200 && new URL(page.url()).pathname === route, `${res?.status()} ${page.url().replace(APP, '')}`);
    }
    await page.waitForTimeout(SETTLE_MS - 3000);
    check(`P public pages ${label}: no 401s, no reports`, tally.unauthorized.length === 0 && tally.reports === 0, summary(tally));
    await ctx.close();
  }

  // A good session keeps working.
  {
    const { ctx, page, tally } = await context(browser, cookieValue(good.token, good.record));
    await page.goto(`${APP}/library`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    check('G a good session stays on /library', new URL(page.url()).pathname === '/library', page.url().replace(APP, ''));
    check('G ... with no 401s', tally.unauthorized.length === 0, summary(tally));
    check('G ... and keeps its cookie', (await pbCookie(ctx)) !== null);
    await ctx.close();
  }
} finally {
  await browser.close();
}

const failed = out.filter((c) => !c.pass).length;
console.log(`\n${out.length - failed}/${out.length} passed`);
process.exit(failed ? 1 : 0);
