/** The PocketBase boot hooks take their accounts from the environment (bughunt W14).
 *
 *      PB_BIN=/path/to/pocketbase node tests/pb-hooks-credentials.test.mjs
 *
 *  ensure_superuser and ensure_admin used to carry the superuser and owner
 *  passwords in the (public) source, and ensure_superuser put its password
 *  back on every boot, so changing it never stuck. Now:
 *    - no env: boot leaves every password alone and only logs a warning
 *    - EMBER_PB_SUPERUSER_EMAIL / _PASSWORD: the superuser is created or
 *      brought in line with them
 *    - EMBER_ADMIN_EMAIL / _PASSWORD: the owner account is created once,
 *      and a password changed later sticks
 *
 *  Boots its own throwaway PocketBase (this checkout's hooks and migrations,
 *  a temp data dir) on PB_PORT (default 8086), one boot at a time. Every
 *  password here is made up for the test. */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PB_BIN = process.env.PB_BIN ?? join(ROOT, 'pocketbase', 'pocketbase');
const PORT = process.env.PB_PORT ?? '8086';
const PB = `http://127.0.0.1:${PORT}`;
const HOOKS = join(ROOT, 'pocketbase', 'pb_hooks');
const MIGRATIONS = join(ROOT, 'pocketbase', 'pb_migrations');
if (!existsSync(PB_BIN)) {
  console.error(`No PocketBase binary at ${PB_BIN}; set PB_BIN.`);
  process.exit(2);
}

const WORK = mkdtempSync(join(tmpdir(), 'ember-w14-'));
const EMPTY_HOOKS = join(WORK, 'empty-hooks');
mkdirSync(EMPTY_HOOKS);

const out = [];
const check = (name, pass, detail = '') => {
  out.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

// The hooks read these; a stray value from the calling shell must not leak in.
const CRED_VARS = ['EMBER_PB_SUPERUSER_EMAIL', 'EMBER_PB_SUPERUSER_PASSWORD', 'EMBER_ADMIN_EMAIL', 'EMBER_ADMIN_PASSWORD'];
function envWith(extra = {}) {
  const env = { ...process.env };
  for (const k of CRED_VARS) delete env[k];
  return { ...env, ...extra };
}

function freshDir(name) {
  const dir = join(WORK, name);
  const r = spawnSync(PB_BIN, ['migrate', 'up', `--dir=${dir}`, `--migrationsDir=${MIGRATIONS}`, `--hooksDir=${EMPTY_HOOKS}`],
    { encoding: 'utf8', env: envWith() });
  if (r.status !== 0) throw new Error(`migrate up failed: ${r.stderr || r.stdout}`);
  return dir;
}

/** The PocketBase CLI (admin create / update), run with the real hooks like
 *  an owner on the host would. */
function cli(dir, args, env = {}) {
  return spawnSync(PB_BIN, [...args, `--dir=${dir}`, `--hooksDir=${HOOKS}`, `--migrationsDir=${MIGRATIONS}`, '--automigrate=0'],
    { encoding: 'utf8', env: envWith(env) });
}

/** One full boot of `pocketbase serve` with the real hooks: waits for health,
 *  runs `during`, stops it. Returns the boot's output. */
async function boot(dir, env, during = async () => {}) {
  // The previous boot must be fully gone, or the health check below would
  // find it instead of this one.
  for (let i = 0; i < 50 && (await fetch(`${PB}/api/health`).then(() => true, () => false)); i++) {
    await new Promise((r) => setTimeout(r, 200));
  }
  const child = spawn(PB_BIN, ['serve', `--http=127.0.0.1:${PORT}`, `--dir=${dir}`, `--hooksDir=${HOOKS}`,
    `--migrationsDir=${MIGRATIONS}`, '--automigrate=0'], { env: envWith(env) });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const exited = new Promise((res) => child.on('exit', res));
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      up = await fetch(`${PB}/api/health`).then((r) => r.ok, () => false);
      if (!up) await new Promise((r) => setTimeout(r, 200));
    }
    if (!up) throw new Error(`PocketBase did not come up on ${PB}:\n${log}`);
    await during();
  } finally {
    child.kill('SIGTERM');
    await Promise.race([exited, new Promise((r) => setTimeout(r, 8000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  return log;
}

async function suSignIn(email, password) {
  const r = await fetch(`${PB}/api/admins/auth-with-password`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password }) });
  return r.ok ? (await r.json()).token : null;
}
async function memberSignIn(email, password) {
  const r = await fetch(`${PB}/api/collections/users/auth-with-password`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password }) });
  return r.ok ? (await r.json()).record : null;
}
/** How many users are admins, or -1 when it can't be read. */
async function adminCount(token) {
  if (!token) return -1;
  const r = await fetch(`${PB}/api/collections/users/records?filter=${encodeURIComponent('is_admin = true')}&perPage=1`,
    { headers: { Authorization: token } });
  return (await r.json()).totalItems;
}

try {
  // ── S1: no env, a password set by hand survives a reboot ───────────────
  {
    const dir = freshDir('s1');
    // The email the old hook looked after; not a secret, the password is.
    const email = 'admin@ember.com';
    const log1 = await boot(dir, {});
    check('S1a PocketBase boots with the credential env unset', true);
    check('S1b the boot log warns that the superuser env is unset', /EMBER_PB_SUPERUSER/.test(log1));
    const set = 'Hand-Set-Pass-2026';
    // `admin update` exits 0 even when there is no such admin; its output says.
    let r = cli(dir, ['admin', 'update', email, set]);
    if (!/Successfully/.test(r.stdout + r.stderr)) r = cli(dir, ['admin', 'create', email, set]);
    const said = (r.stdout + r.stderr).match(/Successfully[^\n]*/)?.[0] ?? (r.stdout + r.stderr).trim().slice(-120);
    check('S1c the owner sets a superuser password with the PocketBase CLI', /Successfully/.test(r.stdout + r.stderr), said);
    let works = false;
    await boot(dir, {}, async () => { works = !!(await suSignIn(email, set)); });
    check('S1d after a reboot with the env unset, that password still works', works);
  }

  // ── S2: env set creates the superuser, then brings it in line ──────────
  {
    const dir = freshDir('s2');
    const email = 'owner-su@w14.test';
    const first = 'First-Env-Pass-2026';
    const second = 'Second-Env-Pass-2026';
    let ok = false;
    await boot(dir, { EMBER_PB_SUPERUSER_EMAIL: email, EMBER_PB_SUPERUSER_PASSWORD: first },
      async () => { ok = !!(await suSignIn(email, first)); });
    check('S2a with the env set, the superuser is created with that password', ok);
    let newOk = false, oldOk = true;
    await boot(dir, { EMBER_PB_SUPERUSER_EMAIL: email, EMBER_PB_SUPERUSER_PASSWORD: second }, async () => {
      newOk = !!(await suSignIn(email, second));
      oldOk = !!(await suSignIn(email, first));
    });
    check('S2b a new password in the env replaces the old one on the next boot', newOk && !oldOk, `new ${newOk}, old ${oldOk}`);
    let still = false;
    await boot(dir, {}, async () => { still = !!(await suSignIn(email, second)); });
    check('S2c unsetting the env later changes nothing', still);
    let weak = false, kept = false;
    const log = await boot(dir, { EMBER_PB_SUPERUSER_EMAIL: email, EMBER_PB_SUPERUSER_PASSWORD: 'short' }, async () => {
      weak = !!(await suSignIn(email, 'short'));
      kept = !!(await suSignIn(email, second));
    });
    check('S2d a password under 10 characters is refused with a warning', !weak && kept && /at least 10/.test(log));
  }

  // ── S3: the owner account ──────────────────────────────────────────────
  {
    const dir = freshDir('s3');
    const suEmail = 'owner-su@w14.test';
    const suPass = 'Su-Pass-For-S3-2026';
    const su = { EMBER_PB_SUPERUSER_EMAIL: suEmail, EMBER_PB_SUPERUSER_PASSWORD: suPass };
    let admins = -1;
    const log = await boot(dir, su, async () => { admins = await adminCount(await suSignIn(suEmail, suPass)); });
    check('S3a with EMBER_ADMIN_* unset, no owner account is created', admins === 0, `admins ${admins}`);
    check('S3b and the boot log says so', /EMBER_ADMIN_EMAIL/.test(log));

    const ownerEmail = 'owner@w14.test';
    const initial = 'Owner-Initial-2026';
    let rec = null;
    await boot(dir, { ...su, EMBER_ADMIN_EMAIL: ownerEmail, EMBER_ADMIN_PASSWORD: initial },
      async () => { rec = await memberSignIn(ownerEmail, initial); });
    check('S3c with EMBER_ADMIN_* set, the owner account is created as an admin', rec?.is_admin === true);

    let initialStill = false;
    await boot(dir, { ...su, EMBER_ADMIN_EMAIL: ownerEmail, EMBER_ADMIN_PASSWORD: 'Another-Pass-2026' },
      async () => { initialStill = !!(await memberSignIn(ownerEmail, initial)); });
    check('S3d an existing owner password is never overwritten by the env', initialStill);
  }

  // ── S4: nothing secret left in the source ──────────────────────────────
  for (const f of ['ensure_superuser.pb.js', 'ensure_admin.pb.js']) {
    const src = readFileSync(join(HOOKS, f), 'utf8');
    check(`S4 ${f} carries no password literal`, !/PASSWORD\s*=\s*["'`]/.test(src) && !/setPassword\(\s*["'`]/.test(src));
  }
} finally {
  rmSync(WORK, { recursive: true, force: true });
}

const failed = out.filter((c) => !c.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
process.exit(failed.length ? 1 : 0);
