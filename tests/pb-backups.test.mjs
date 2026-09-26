/** Nightly backups: pocketbase/pb_hooks/ensure_backups.pb.js.
 *
 *      PB_BIN=/path/to/pocketbase node tests/pb-backups.test.mjs
 *      BACKUPS_QUICK=1 ...   skips B6, the one-minute wait for a scheduled backup
 *
 *  Checks that the hook turns on PocketBase's own automatic backups once
 *  ("0 4 * * *", keep 7), never overrides a schedule the host chose (before
 *  or after the hook first ran, including turning them off), lets
 *  EMBER_BACKUP_CRON / EMBER_BACKUP_KEEP win, survives bad values, and that
 *  a backup made now (and by the schedule) really lands in pb_data/backups.
 *
 *  Boots its own throwaway PocketBase (this checkout's hooks and migrations,
 *  a temp data dir) on PB_PORT (default 8158), one boot at a time. */
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PB_BIN = process.env.PB_BIN ?? join(ROOT, 'pocketbase', 'pocketbase');
const PORT = process.env.PB_PORT ?? '8158';
const PB = `http://127.0.0.1:${PORT}`;
const HOOKS = join(ROOT, 'pocketbase', 'pb_hooks');
const MIGRATIONS = join(ROOT, 'pocketbase', 'pb_migrations');
if (!existsSync(PB_BIN)) {
  console.error(`No PocketBase binary at ${PB_BIN}; set PB_BIN.`);
  process.exit(2);
}

const WORK = mkdtempSync(join(tmpdir(), 'ember-backups-'));
const EMPTY_HOOKS = join(WORK, 'empty-hooks');
mkdirSync(EMPTY_HOOKS);
// The real hooks minus this one: a host's PocketBase before this release.
const HOOKS_BEFORE = join(WORK, 'hooks-before');
cpSync(HOOKS, HOOKS_BEFORE, { recursive: true, filter: (p) => !p.endsWith('ensure_backups.pb.js') });

const SU = { EMBER_PB_SUPERUSER_EMAIL: 'su@backups.test', EMBER_PB_SUPERUSER_PASSWORD: 'Backups-Test-2026' };

const out = [];
const check = (name, pass, detail = '') => {
  out.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const OWN_VARS = ['EMBER_BACKUP_CRON', 'EMBER_BACKUP_KEEP', 'EMBER_ADMIN_EMAIL', 'EMBER_ADMIN_PASSWORD',
  'EMBER_PB_SUPERUSER_EMAIL', 'EMBER_PB_SUPERUSER_PASSWORD'];
function envWith(extra = {}) {
  const env = { ...process.env };
  for (const k of OWN_VARS) delete env[k];
  return { ...env, ...SU, ...extra };
}

function freshDir(name) {
  const dir = join(WORK, name);
  const r = spawnSync(PB_BIN, ['migrate', 'up', `--dir=${dir}`, `--migrationsDir=${MIGRATIONS}`, `--hooksDir=${EMPTY_HOOKS}`],
    { encoding: 'utf8', env: envWith() });
  if (r.status !== 0) throw new Error(`migrate up failed: ${r.stderr || r.stdout}`);
  return dir;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One full boot of `pocketbase serve`: waits for health, runs `during`,
 *  stops it. Returns the boot's output. */
async function boot(dir, env, during = async () => {}, hooks = HOOKS) {
  for (let i = 0; i < 50 && (await fetch(`${PB}/api/health`).then(() => true, () => false)); i++) await sleep(200);
  const child = spawn(PB_BIN, ['serve', `--http=127.0.0.1:${PORT}`, `--dir=${dir}`, `--hooksDir=${hooks}`,
    `--migrationsDir=${MIGRATIONS}`, '--automigrate=0'], { env: envWith(env) });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const exited = new Promise((res) => child.on('exit', res));
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      up = await fetch(`${PB}/api/health`).then((r) => r.ok, () => false);
      if (!up) await sleep(200);
    }
    if (!up) throw new Error(`PocketBase did not come up on ${PB}:\n${log}`);
    await during();
  } finally {
    child.kill('SIGTERM');
    await Promise.race([exited, sleep(8000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  return log;
}

async function token() {
  const r = await fetch(`${PB}/api/admins/auth-with-password`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: SU.EMBER_PB_SUPERUSER_EMAIL, password: SU.EMBER_PB_SUPERUSER_PASSWORD }) });
  if (!r.ok) throw new Error(`superuser sign-in failed: ${r.status}`);
  return (await r.json()).token;
}
async function backupSettings() {
  const r = await fetch(`${PB}/api/settings`, { headers: { Authorization: await token() } });
  const b = (await r.json()).backups;
  return { cron: b.cron, keep: b.cronMaxKeep };
}
/** What an owner does in the admin UI, Settings > Backups. */
async function setBackupSettings(cron, keep) {
  const r = await fetch(`${PB}/api/settings`, {
    method: 'PATCH', headers: { Authorization: await token(), 'content-type': 'application/json' },
    body: JSON.stringify({ backups: { cron, cronMaxKeep: keep } }) });
  if (!r.ok) throw new Error(`settings PATCH failed: ${r.status} ${await r.text()}`);
}
const zips = (dir) => (existsSync(join(dir, 'backups')) ? readdirSync(join(dir, 'backups')).filter((f) => f.endsWith('.zip')) : []);
const same = (a, b) => a.cron === b.cron && a.keep === b.keep;
const show = (s) => `'${s.cron}' keep ${s.keep}`;

try {
  // ── B1/B2: fresh install, defaults on, manual backup lands on disk ─────
  {
    const dir = freshDir('b1');
    let s = null;
    let listed = [];
    let created = 0;
    const log = await boot(dir, {}, async () => {
      s = await backupSettings();
      const t = await token();
      created = (await fetch(`${PB}/api/backups`, {
        method: 'POST', headers: { Authorization: t, 'content-type': 'application/json' }, body: '{}' })).status;
      listed = await (await fetch(`${PB}/api/backups`, { headers: { Authorization: t } })).json();
    });
    check('B1a a fresh install gets nightly backups at 04:00', s?.cron === '0 4 * * *', show(s));
    check('B1b keeping the last 7', s?.keep === 7, show(s));
    check('B1c the boot log says so', /\[ensure_backups\] automatic backups: '0 4 \* \* \*', keeping the last 7/.test(log));
    check('B2a a backup made now succeeds', created === 204, `status ${created}`);
    check('B2b and PocketBase lists it', listed.length === 1 && /^pb_backup_.*\.zip$/.test(listed[0]?.key ?? ''),
      listed.map((b) => b.key).join(','));
    check('B2c the zip is in pb_data/backups', zips(dir).length === 1, zips(dir).join(','));

    let again = null;
    const log2 = await boot(dir, {}, async () => { again = await backupSettings(); });
    check('B1d a second boot changes nothing and logs nothing', same(again, { cron: '0 4 * * *', keep: 7 })
      && !/\[ensure_backups\]/.test(log2), show(again));

    // The owner picks another time in the admin UI: it sticks.
    let afterEdit = null;
    await boot(dir, {}, async () => setBackupSettings('30 2 * * *', 3));
    await boot(dir, {}, async () => { afterEdit = await backupSettings(); });
    check('B3a a schedule the owner changed later survives a reboot', same(afterEdit, { cron: '30 2 * * *', keep: 3 }), show(afterEdit));

    // The owner turns them off: they stay off.
    let afterOff = null;
    await boot(dir, {}, async () => setBackupSettings('', 3));
    await boot(dir, {}, async () => { afterOff = await backupSettings(); });
    check('B3b backups the owner turned off stay off', afterOff?.cron === '', show(afterOff));
  }

  // ── B4: a host that already had its own schedule before this release ───
  {
    const dir = freshDir('b4');
    await boot(dir, {}, async () => setBackupSettings('0 1 * * 0', 2), HOOKS_BEFORE);
    let s = null;
    await boot(dir, {}, async () => { s = await backupSettings(); });
    check('B4 an existing schedule is kept on the first boot with the hook', same(s, { cron: '0 1 * * 0', keep: 2 }), show(s));
  }

  // ── B5: env overrides ───────────────────────────────────────────────────
  {
    const dir = freshDir('b5');
    await boot(dir, {});
    let s = null;
    await boot(dir, { EMBER_BACKUP_CRON: '15 3 * * *', EMBER_BACKUP_KEEP: '10' }, async () => { s = await backupSettings(); });
    check('B5a EMBER_BACKUP_CRON / _KEEP are applied', same(s, { cron: '15 3 * * *', keep: 10 }), show(s));

    await boot(dir, {}, async () => setBackupSettings('0 5 * * *', 4));
    await boot(dir, { EMBER_BACKUP_CRON: '15 3 * * *' }, async () => { s = await backupSettings(); });
    check('B5b the env wins over a schedule set in the admin UI', s?.cron === '15 3 * * *', show(s));

    await boot(dir, { EMBER_BACKUP_CRON: 'off' }, async () => { s = await backupSettings(); });
    check('B5c EMBER_BACKUP_CRON=off turns automatic backups off', s?.cron === '', show(s));

    let before = null;
    await boot(dir, { EMBER_BACKUP_CRON: '0 4 * * *', EMBER_BACKUP_KEEP: '5' }, async () => { before = await backupSettings(); });
    let health = 0;
    const log = await boot(dir, { EMBER_BACKUP_CRON: 'not a cron' }, async () => {
      health = (await fetch(`${PB}/api/health`)).status;
      s = await backupSettings();
    });
    check('B5d a bad EMBER_BACKUP_CRON leaves the schedule alone and still boots',
      health === 200 && same(s, before) && /\[ensure_backups\] could not save/.test(log), show(s));

    const log2 = await boot(dir, { EMBER_BACKUP_KEEP: 'lots' }, async () => { s = await backupSettings(); });
    check('B5e a bad EMBER_BACKUP_KEEP is ignored with a warning', same(s, before) && /EMBER_BACKUP_KEEP must be/.test(log2), show(s));
  }

  // ── B6: the schedule really fires ──────────────────────────────────────
  if (process.env.BACKUPS_QUICK !== '1') {
    const dir = freshDir('b6');
    let auto = [];
    await boot(dir, { EMBER_BACKUP_CRON: '* * * * *' }, async () => {
      for (let i = 0; i < 80 && auto.length === 0; i++) {
        auto = zips(dir).filter((f) => f.startsWith('@auto_pb_backup_'));
        if (auto.length === 0) await sleep(1000);
      }
    });
    check('B6 a scheduled backup appears in pb_data/backups', auto.length >= 1, auto.join(','));
  } else {
    console.log('SKIP  B6 (BACKUPS_QUICK=1)');
  }
} finally {
  rmSync(WORK, { recursive: true, force: true });
}

const failed = out.filter((c) => !c.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
process.exit(failed.length ? 1 : 0);
