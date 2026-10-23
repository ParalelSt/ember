/** A brand new install comes up complete on its first start.
 *
 *    PB_BIN=/path/to/pocketbase node tests/start-static-fresh-pb.test.mjs
 *
 *  PocketBase fires its boot hooks before it makes its own tables, so on the
 *  very first `serve` of an empty pb_data every ensure_* hook found nothing:
 *  no superuser (Next could not sign in), none of Ember's collections, and
 *  the `tracks` catalog still member-writable, all until a restart.
 *  start-static.sh now runs `migrate up` first when there is no database.
 *
 *  start-static.sh is copied into a temp root with a copy of the PocketBase
 *  binary, this checkout's hooks and migrations and an empty pb_data there
 *  (never the repo's), PocketBase on PB_PORT (default 8195), Next swapped
 *  for a fake, the build skipped. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PB_BIN = process.env.PB_BIN ?? path.join(REPO, 'pocketbase', 'pocketbase');
const PORT = process.env.PB_PORT ?? '8195';
const PB = `http://127.0.0.1:${PORT}`;
if (!fs.existsSync(PB_BIN)) {
  console.error(`No PocketBase binary at ${PB_BIN}; set PB_BIN.`);
  process.exit(2);
}

const failed = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failed.push(name);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'start-static-fresh-pb.'));
const root = path.join(tmp, 'root');
fs.mkdirSync(path.join(root, 'apps/web'), { recursive: true });
fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
fs.mkdirSync(path.join(root, 'pocketbase'), { recursive: true });
fs.copyFileSync(path.join(REPO, 'start-static.sh'), path.join(root, 'start-static.sh'));
fs.copyFileSync(path.join(REPO, 'scripts/crash-report.mjs'), path.join(root, 'scripts/crash-report.mjs'));
fs.copyFileSync(path.join(REPO, 'scripts/read-env.mjs'), path.join(root, 'scripts/read-env.mjs'));
fs.copyFileSync(path.join(REPO, 'update.sh'), path.join(root, 'update.sh'));
fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(root, 'node_modules'));
fs.copyFileSync(PB_BIN, path.join(root, 'pocketbase/pocketbase'));
fs.chmodSync(path.join(root, 'pocketbase/pocketbase'), 0o755);
for (const d of ['pb_hooks', 'pb_migrations']) {
  fs.cpSync(path.join(REPO, 'pocketbase', d), path.join(root, 'pocketbase', d), { recursive: true });
}

const SU_EMAIL = 'su@fresh.test';
const SU_PASSWORD = 'Fresh-Start-Pass-2026';
fs.writeFileSync(path.join(root, 'apps/web/.env.local'), [
  `POCKETBASE_ADMIN_EMAIL=${SU_EMAIL}`,
  `POCKETBASE_ADMIN_PASSWORD=${SU_PASSWORD}`,
  'PORT=3296',
  `POCKETBASE_PORT=${PORT}`,
  '',
].join('\n'));
fs.writeFileSync(path.join(tmp, 'next.mjs'), 'setInterval(() => {}, 1 << 30);\n');

const env = { ...process.env };
for (const k of ['PORT', 'POCKETBASE_PORT', 'POCKETBASE_ADMIN_EMAIL', 'POCKETBASE_ADMIN_PASSWORD',
  'EMBER_PB_SUPERUSER_EMAIL', 'EMBER_PB_SUPERUSER_PASSWORD', 'EMBER_ADMIN_EMAIL', 'EMBER_ADMIN_PASSWORD',
  'EMBER_BACKUP_CRON', 'EMBER_BACKUP_KEEP', 'DISCORD_BUG_REPORT_WEBHOOK_URL', 'WATCHDOG_CMD_PB']) delete env[k];
Object.assign(env, {
  WATCHDOG_SKIP_BUILD: '1',
  WATCHDOG_CMD_NEXT: `exec node "${path.join(tmp, 'next.mjs')}"`,
  // Never a real webhook: nothing should post, and if it did it goes nowhere.
  DISCORD_CRASH_WEBHOOK_URL: 'http://127.0.0.1:9/hook',
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = () => fetch(`${PB}/api/health`).then((r) => r.ok, () => false);
if (await up()) {
  console.error(`Something already answers on ${PB}; pick a free PB_PORT.`);
  process.exit(2);
}

const wd = spawn('bash', [path.join(root, 'start-static.sh')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
wd.stdout.on('data', (d) => { out += d; });
wd.stderr.on('data', (d) => { out += d; });

try {
  let ok = false;
  for (let i = 0; i < 150 && !ok; i++) {
    ok = await up();
    if (!ok) await sleep(200);
  }
  check('PocketBase comes up on a brand new pb_data', ok, out.slice(-2000));
  if (ok) {
    // The boot hooks run just after health turns green: give them a moment.
    let token = null;
    for (let i = 0; i < 25 && !token; i++) {
      const r = await fetch(`${PB}/api/admins/auth-with-password`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identity: SU_EMAIL, password: SU_PASSWORD }) });
      token = r.ok ? (await r.json()).token : null;
      if (!token) await sleep(200);
    }
    check('the superuser Next signs in with exists on the first boot', !!token);
    if (token) {
      const r = await fetch(`${PB}/api/collections?perPage=200`, { headers: { Authorization: token } });
      const cols = r.ok ? (await r.json()).items : [];
      const names = cols.map((c) => c.name);
      for (const n of ['uploads', 'tabs', 'login_requests', 'playlist_members']) {
        check(`the ${n} collection exists on the first boot`, names.includes(n), names.join(', '));
      }
      const tracks = cols.find((c) => c.name === 'tracks');
      check('the tracks catalog is server-written from the first boot',
        tracks && tracks.createRule === null && tracks.updateRule === null, JSON.stringify(tracks && [tracks.createRule, tracks.updateRule]));
    }
  }
} finally {
  wd.kill('SIGTERM');
  await new Promise((r) => {
    const t = setTimeout(() => { wd.kill('SIGKILL'); r(); }, 15000);
    wd.on('exit', () => { clearTimeout(t); r(); });
  });
  for (let i = 0; i < 50 && (await up()); i++) await sleep(200);
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failed.length ? `\n${failed.length} check(s) failed` : '\nall checks passed');
process.exit(failed.length ? 1 : 0);
