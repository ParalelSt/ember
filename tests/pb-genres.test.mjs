/** PocketBase rules for the genre mixes' collections
 *  (pocketbase/pb_hooks/ensure_artist_genres.pb.js, ensure_mixes.pb.js).
 *
 *      PB_BIN=/path/to/pocketbase node tests/pb-genres.test.mjs
 *
 *  Boots its own throwaway PocketBase (this checkout's hooks and
 *  migrations, a temp data dir) on PB_PORT (default 8097). Checks:
 *   - artist_genres exists with a unique artist_key, and is admin only: a
 *     member can neither list, view nor write it
 *   - a second boot leaves it alone (the hook is idempotent) */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PB_BIN = process.env.PB_BIN ?? join(ROOT, 'pocketbase', 'pocketbase');
const PORT = process.env.PB_PORT ?? '8097';
if (PORT === '8090') { console.error('Never the live PocketBase port.'); process.exit(2); }
const PB = `http://127.0.0.1:${PORT}`;
const HOOKS = join(ROOT, 'pocketbase', 'pb_hooks');
const MIGRATIONS = join(ROOT, 'pocketbase', 'pb_migrations');
if (!existsSync(PB_BIN)) {
  console.error(`No PocketBase binary at ${PB_BIN}; set PB_BIN.`);
  process.exit(2);
}

const WORK = mkdtempSync(join(tmpdir(), 'ember-pb-genres-'));
const EMPTY_HOOKS = join(WORK, 'empty-hooks');
mkdirSync(EMPTY_HOOKS);
const SU_EMAIL = 'su@genres.test';
const SU_PASSWORD = 'Genres-Superuser-2026';
const ENV = { EMBER_PB_SUPERUSER_EMAIL: SU_EMAIL, EMBER_PB_SUPERUSER_PASSWORD: SU_PASSWORD };

const out = [];
const check = (name, pass, detail = '') => {
  out.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

function freshDir(name) {
  const dir = join(WORK, name);
  const r = spawnSync(PB_BIN, ['migrate', 'up', `--dir=${dir}`, `--migrationsDir=${MIGRATIONS}`, `--hooksDir=${EMPTY_HOOKS}`],
    { encoding: 'utf8', env: process.env });
  if (r.status !== 0) throw new Error(`migrate up failed: ${r.stderr || r.stdout}`);
  return dir;
}

async function boot(dir, during = async () => {}) {
  if (await fetch(`${PB}/api/health`).then(() => true, () => false)) throw new Error(`something already listens on ${PB}; set PB_PORT`);
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

const j = (method, path, token, body) => fetch(PB + path, {
  method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: token } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});

async function suToken() {
  for (const p of ['/api/admins/auth-with-password', '/api/collections/_superusers/auth-with-password']) {
    const r = await j('POST', p, null, { identity: SU_EMAIL, password: SU_PASSWORD });
    if (r.ok) return (await r.json()).token;
  }
  throw new Error('superuser sign-in failed');
}

async function member(su, label) {
  const email = `${label}@genres.test`;
  const pw = 'Member-Pass-2026';
  const c = await j('POST', '/api/collections/users/records', su, { email, password: pw, passwordConfirm: pw, name: label, verified: true });
  if (!c.ok) throw new Error(`create ${label}: ${await c.text()}`);
  const a = await (await j('POST', '/api/collections/users/auth-with-password', null, { identity: email, password: pw })).json();
  return { id: a.record.id, token: a.token };
}

try {
  const dir = freshDir('genres');
  const boot1 = await boot(dir, async () => {
    const su = await suToken();
    const col = await (await j('GET', '/api/collections/artist_genres', su)).json();
    check('artist_genres exists', col?.name === 'artist_genres', JSON.stringify(col?.message ?? ''));
    check('artist_genres is admin only (every rule null)',
      [col.listRule, col.viewRule, col.createRule, col.updateRule, col.deleteRule].every((r) => r === null));
    check('artist_key is unique', (col.indexes ?? []).some((s) => /UNIQUE INDEX .*artist_key/.test(s)));

    const row = await j('POST', '/api/collections/artist_genres/records', su,
      { artist_key: 'gojira', name: 'Gojira', family: 'rock-metal', families: { 'rock-metal': 1 }, source: 'lastfm', status: 'found', fetched_at: '2026-10-16T04:00:00.000Z' });
    check('the admin client can write a row', row.ok, row.ok ? '' : await row.text());
    const dup = await j('POST', '/api/collections/artist_genres/records', su, { artist_key: 'gojira', source: 'chart', status: 'found' });
    check('a second row for the same artist is refused', !dup.ok);
    const rowId = row.ok ? (await row.clone().json().catch(() => null))?.id : null;

    const m = await member(su, 'listener');
    const list = await j('GET', '/api/collections/artist_genres/records', m.token);
    check('a member cannot list artist_genres', list.status === 403, String(list.status));
    const created = await j('POST', '/api/collections/artist_genres/records', m.token, { artist_key: 'x', source: 'manual', status: 'found' });
    check('a member cannot write artist_genres', created.status === 403 || created.status === 400, String(created.status));
    if (rowId) {
      const view = await j('GET', `/api/collections/artist_genres/records/${rowId}`, m.token);
      check('a member cannot view a row', view.status === 403 || view.status === 404, String(view.status));
    }
  });
  check('PocketBase boots with the genre hooks', boot1.up, boot1.up ? '' : boot1.log.slice(-400));
  const boot2 = await boot(dir);
  const ok2 = boot2.up && !/could not create/.test(boot2.log);
  check('a second boot is fine (hooks are idempotent)', ok2, ok2 ? '' : boot2.log.slice(-300));
} catch (e) {
  check('run', false, e.message);
} finally {
  rmSync(WORK, { recursive: true, force: true });
}

const failed = out.filter((c) => !c.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
process.exit(failed.length ? 1 : 0);
