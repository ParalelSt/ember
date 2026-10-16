/** Shared parts of the genre charts and mixes browser sims
 *  (tests/charts-ui.test.mjs, tests/mixes-ui.test.mjs): Chromium lookup, a
 *  `next start` of the existing build with tests/fake-player.sh as the
 *  player, the sandbox superuser, a throwaway member, and PASS/FAIL lines.
 *
 *  Env: PB_URL (default http://127.0.0.1:8096), APP_PORT (default 3031),
 *  PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD, CHROME_PATH. Never the live ports. */
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WEB = path.join(ROOT, 'apps/web');
export const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8096';
export const PORT = process.env.APP_PORT ?? '3031';
export const APP_URL = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL ?? 'admin@ember.com';
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD ?? '';

if (['3000', '3066', '3072'].includes(PORT) || /:8090\b/.test(PB_URL)) {
  console.error('Refusing to run against a live port; pick a sandbox APP_PORT / PB_URL.');
  process.exit(2);
}

export async function loadChromium() {
  try {
    return (await import('playwright-core')).chromium;
  } catch {
    console.error('This test needs playwright-core (already a root devDependency).');
    process.exit(2);
  }
}

export function findChrome() {
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

export const checks = [];
export const check = (name, pass, detail = '') => {
  checks.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
};
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function finish() {
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  process.exit(failed ? 1 : 0);
}

/** `next start` on PORT with the fake player; resolves once it answers. */
export async function startApp({ music, calls, env = {} }) {
  if (await fetch(APP_URL).then(() => true, () => false)) throw new Error(`something already listens on ${APP_URL}`);
  const child = spawn('npx', ['next', 'start', '-p', PORT, '-H', '127.0.0.1'], {
    cwd: WEB,
    env: {
      ...process.env,
      POCKETBASE_URL: PB_URL,
      POCKETBASE_ADMIN_EMAIL: ADMIN_EMAIL,
      POCKETBASE_ADMIN_PASSWORD: ADMIN_PASSWORD,
      DISCORD_BUG_REPORT_WEBHOOK_URL: 'http://127.0.0.1:1/none',
      PYTHON_BIN: '/bin/bash',
      PLAYER_SCRIPT: path.join(ROOT, 'tests/fake-player.sh'),
      MUSIC_DIR: music,
      FAKE_PLAYER_LOG: calls,
      FAKE_DOWNLOAD_SECONDS: '0',
      STREAM_CACHE_WARM: '0',
      CLEANUP_DISABLED: '1',
      PRANK_TICK_DISABLED: '1',
      IMPORT_RUNNER_DISABLED: '1',
      UPDATE_WARMUP_DISABLED: '1',
      // No Last.fm or MusicBrainz from a test, ever.
      LASTFM_API_KEY: '',
      GENRES_LOOKUP_DISABLED: '1',
      ...env,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: true,
  });
  let err = '';
  child.stderr.on('data', (d) => { err += d.toString(); });
  for (let i = 0; i < 60; i++) {
    const r = await fetch(APP_URL).catch(() => null);
    if (r && r.status < 500) return child;
    await sleep(500);
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  throw new Error(`app did not start on ${PORT}: ${err.slice(-400)}`);
}

export async function stopApp(child) {
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  for (let i = 0; i < 20; i++) {
    if (!(await fetch(APP_URL).then(() => true, () => false))) return;
    await sleep(250);
  }
}

export async function adminToken() {
  if (!ADMIN_PASSWORD) throw new Error('set PB_ADMIN_PASSWORD to the sandbox superuser password');
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const r = await fetch(PB_URL + p, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: ADMIN_EMAIL, password: ADMIN_PASSWORD }) });
    if (r.ok) return (await r.json()).token;
  }
  throw new Error('no superuser sign-in');
}

/** A throwaway member: { id, cookieValue }. */
export async function newMember(label) {
  const tok = await adminToken();
  const email = `${label}-${process.pid}-${Math.floor(Math.random() * 1e6)}@ember.test`;
  const pw = `Pw-${Math.random().toString(36).slice(2)}-x9`;
  await fetch(`${PB_URL}/api/collections/users/records`, { method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: tok },
    body: JSON.stringify({ email, password: pw, passwordConfirm: pw, name: label, verified: true }) });
  const auth = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password: pw }) })
    .then((r) => r.json());
  if (!auth.token) throw new Error('member sign-in failed');
  return { id: auth.record.id, token: auth.token, cookieValue: encodeURIComponent(JSON.stringify({ token: auth.token, record: auth.record })) };
}
