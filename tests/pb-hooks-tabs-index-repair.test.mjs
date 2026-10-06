/** bughunt X11: PocketBase used to refuse to start if the tabs collection's
 *  indexes were ever re-saved from the admin UI. The admin UI re-serializes
 *  each index's SQL (backtick-quoted identifiers) when a collection is
 *  saved there, so ensure_tabs.pb.js's plain string match against its
 *  NEW_INDEXES list stopped recognising an index that was still there under
 *  a different spelling, tried to create it again, SQLite refused the name
 *  collision, and the thrown error stopped PocketBase from booting at all.
 *
 *      PB_BIN=/path/to/pocketbase node tests/pb-hooks-tabs-index-repair.test.mjs
 *
 *  Boots its own throwaway PocketBase (this checkout's hooks and
 *  migrations, a temp data dir) on PB_PORT (default 8087), one boot at a
 *  time. Reproduces the admin UI's re-save with a raw PATCH (the same shape
 *  PocketBase itself sends: backtick-quoted index SQL), then reboots and
 *  checks PocketBase still starts. */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PB_BIN = process.env.PB_BIN ?? join(ROOT, 'pocketbase', 'pocketbase');
const PORT = process.env.PB_PORT ?? '8087';
const PB = `http://127.0.0.1:${PORT}`;
const HOOKS = join(ROOT, 'pocketbase', 'pb_hooks');
const MIGRATIONS = join(ROOT, 'pocketbase', 'pb_migrations');
if (!existsSync(PB_BIN)) {
  console.error(`No PocketBase binary at ${PB_BIN}; set PB_BIN.`);
  process.exit(2);
}

const WORK = mkdtempSync(join(tmpdir(), 'ember-x11-'));
const EMPTY_HOOKS = join(WORK, 'empty-hooks');
mkdirSync(EMPTY_HOOKS);

const out = [];
const check = (name, pass, detail = '') => {
  out.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const SU_EMAIL = 'su@x11.test';
const SU_PASSWORD = 'X11-Superuser-2026';
const ENV = { EMBER_PB_SUPERUSER_EMAIL: SU_EMAIL, EMBER_PB_SUPERUSER_PASSWORD: SU_PASSWORD };

function freshDir(name) {
  const dir = join(WORK, name);
  const r = spawnSync(PB_BIN, ['migrate', 'up', `--dir=${dir}`, `--migrationsDir=${MIGRATIONS}`, `--hooksDir=${EMPTY_HOOKS}`],
    { encoding: 'utf8', env: process.env });
  if (r.status !== 0) throw new Error(`migrate up failed: ${r.stderr || r.stdout}`);
  return dir;
}

/** One full boot of `pocketbase serve` with the real hooks: waits for
 *  health, runs `during`, stops it. Returns the boot's stdout+stderr and
 *  whether it ever came up. */
async function boot(dir, during = async () => {}) {
  for (let i = 0; i < 50 && (await fetch(`${PB}/api/health`).then(() => true, () => false)); i++) {
    await new Promise((r) => setTimeout(r, 200));
  }
  const child = spawn(PB_BIN, ['serve', `--http=127.0.0.1:${PORT}`, `--dir=${dir}`, `--hooksDir=${HOOKS}`,
    `--migrationsDir=${MIGRATIONS}`, '--automigrate=0'], { env: { ...process.env, ...ENV } });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const exited = new Promise((res) => child.on('exit', res));
  let up = false;
  try {
    for (let i = 0; i < 100 && !up; i++) {
      up = await fetch(`${PB}/api/health`).then((r) => r.ok, () => false);
      if (!up) await new Promise((r) => setTimeout(r, 200));
    }
    if (up) await during();
  } finally {
    child.kill('SIGTERM');
    await Promise.race([exited, new Promise((r) => setTimeout(r, 8000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  return { log, up };
}

async function suToken() {
  const r = await fetch(`${PB}/api/admins/auth-with-password`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: SU_EMAIL, password: SU_PASSWORD }),
  });
  if (!r.ok) throw new Error(`superuser sign-in failed: ${await r.text()}`);
  return (await r.json()).token;
}

/** What the admin UI does when a collection with indexes is opened and
 *  saved again unchanged: PocketBase re-serializes each index's SQL with
 *  backtick-quoted identifiers. Same names, same columns, different text. */
async function reserializeTabsIndexes(token) {
  const before = await (await fetch(`${PB}/api/collections/tabs`, { headers: { Authorization: token } })).json();
  const renamed = before.indexes.map((sql) => {
    const m = /CREATE (UNIQUE )?INDEX (\w+) ON (\w+) \(([^)]+)\)/.exec(sql);
    if (!m) return sql;
    const [, unique = '', name, table, cols] = m;
    const quotedCols = cols.split(',').map((c) => `\`${c.trim()}\``).join(', ');
    return `CREATE ${unique}INDEX \`${name}\` ON \`${table}\` (${quotedCols})`;
  });
  const r = await fetch(`${PB}/api/collections/${before.id}`, {
    method: 'PATCH', headers: { Authorization: token, 'content-type': 'application/json' },
    body: JSON.stringify({ indexes: renamed }),
  });
  if (!r.ok) throw new Error(`re-saving tabs indexes failed: ${await r.text()}`);
  return { before: before.indexes, after: renamed };
}

try {
  const dir = freshDir('x11');

  // ── Boot 1: fresh data dir, ensure_tabs creates the tabs collection ────
  let created = false;
  const boot1 = await boot(dir, async () => { created = true; });
  check('boot 1 starts (tabs collection created)', boot1.up && created, boot1.up ? '' : boot1.log.slice(-400));

  // ── Re-save the tabs collection's indexes the way the admin UI would ───
  let reindexed = null;
  await boot(dir, async () => { reindexed = await reserializeTabsIndexes(await suToken()); });
  check('the tabs indexes were re-saved with normalized SQL', !!reindexed
    && reindexed.before.some((s) => !/`/.test(s)) && reindexed.after.every((s) => /`/.test(s)));

  // ── Boot 2 (before the fix, this is where PocketBase failed to start) ──
  const boot2 = await boot(dir);
  check('boot 2 still starts after the admin UI touched the indexes', boot2.up, boot2.up ? '' : boot2.log.slice(-600));
  check('boot 2 did not crash on a duplicate index', !/already exists/.test(boot2.log));
} finally {
  rmSync(WORK, { recursive: true, force: true });
}

const failed = out.filter((c) => !c.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
process.exit(failed.length ? 1 : 0);
