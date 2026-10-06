/** bughunt X4: deleting a member who had queued a song in a carlist, skipped
 *  one, or uploaded a song failed. Those links (session_tracks.added_by,
 *  session_commands.issued_by, uploads.uploader) were required relations
 *  that keep their row when the member goes, so PocketBase could not empty
 *  them and refused the delete.
 *
 *      PB_BIN=/path/to/pocketbase node tests/pb-hooks-member-delete.test.mjs
 *
 *  Boots its own throwaway PocketBase (this checkout's hooks and migrations,
 *  a temp data dir) on PB_PORT (default 8085), one boot at a time. Boot 1 is
 *  an install from before the fix: the three links are made required again
 *  by hand. Boot 2 runs the hooks over it, then deletes such a member. */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PB_BIN = process.env.PB_BIN ?? join(ROOT, 'pocketbase', 'pocketbase');
const PORT = process.env.PB_PORT ?? '8085';
const PB = `http://127.0.0.1:${PORT}`;
const HOOKS = join(ROOT, 'pocketbase', 'pb_hooks');
const MIGRATIONS = join(ROOT, 'pocketbase', 'pb_migrations');
if (!existsSync(PB_BIN)) {
  console.error(`No PocketBase binary at ${PB_BIN}; set PB_BIN.`);
  process.exit(2);
}

const WORK = mkdtempSync(join(tmpdir(), 'ember-x4-'));
const EMPTY_HOOKS = join(WORK, 'empty-hooks');
mkdirSync(EMPTY_HOOKS);

const out = [];
const check = (name, pass, detail = '') => {
  out.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const SU_EMAIL = 'su@x4.test';
const SU_PASSWORD = 'X4-Superuser-2026';
const ENV = { EMBER_PB_SUPERUSER_EMAIL: SU_EMAIL, EMBER_PB_SUPERUSER_PASSWORD: SU_PASSWORD };
const LINKS = [
  ['session_tracks', 'added_by'],
  ['session_commands', 'issued_by'],
  ['uploads', 'uploader'],
];

function freshDir(name) {
  const dir = join(WORK, name);
  const r = spawnSync(PB_BIN, ['migrate', 'up', `--dir=${dir}`, `--migrationsDir=${MIGRATIONS}`, `--hooksDir=${EMPTY_HOOKS}`],
    { encoding: 'utf8', env: process.env });
  if (r.status !== 0) throw new Error(`migrate up failed: ${r.stderr || r.stdout}`);
  return dir;
}

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

async function api(token, method, path, body) {
  const r = await fetch(`${PB}${path}`, {
    method, headers: { Authorization: token, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { ok: r.ok, status: r.status, body: text ? JSON.parse(text) : null };
}

/** An install from before the fix: the three links required again. */
async function makeLinksRequired(token) {
  for (const [name, field] of LINKS) {
    const col = (await api(token, 'GET', `/api/collections/${name}`)).body;
    const schema = col.schema.map((f) => (f.name === field ? { ...f, required: true } : f));
    const r = await api(token, 'PATCH', `/api/collections/${col.id}`, { schema });
    if (!r.ok) throw new Error(`making ${name}.${field} required failed: ${JSON.stringify(r.body)}`);
  }
}

async function required(token) {
  const res = {};
  for (const [name, field] of LINKS) {
    const col = (await api(token, 'GET', `/api/collections/${name}`)).body;
    res[`${name}.${field}`] = col.schema.find((f) => f.name === field)?.required;
  }
  return res;
}

try {
  const dir = freshDir('x4');

  let before = null;
  const boot1 = await boot(dir, async () => {
    const token = await suToken();
    await makeLinksRequired(token);
    before = await required(token);
  });
  check('boot 1 starts and the old install is set up', boot1.up && !!before && Object.values(before).every(Boolean),
    boot1.up ? JSON.stringify(before) : boot1.log.slice(-400));

  await boot(dir, async () => {
    const token = await suToken();
    const after = await required(token);
    check('boot 2 makes the three links optional', Object.values(after).every((v) => v === false), JSON.stringify(after));

    const host = await api(token, 'POST', '/api/collections/users/records',
      { email: 'host@x4.test', password: 'Host-Pass-2026', passwordConfirm: 'Host-Pass-2026' });
    const friend = await api(token, 'POST', '/api/collections/users/records',
      { email: 'friend@x4.test', password: 'Friend-Pass-2026', passwordConfirm: 'Friend-Pass-2026' });
    const track = await api(token, 'POST', '/api/collections/tracks/records',
      { external_id: 'youtube:x4aaaaaaaaa', source: 'youtube', source_id: 'x4aaaaaaaaa', title: 'Song' });
    const session = await api(token, 'POST', '/api/collections/sessions/records',
      { code: 'X4X4X4', name: 'Road trip', host: host.body.id, active: true, now_index: 0 });
    const queued = await api(token, 'POST', '/api/collections/session_tracks/records',
      { session: session.body.id, track: track.body.id, position: 1, added_by: friend.body.id });
    const skipped = await api(token, 'POST', '/api/collections/session_commands/records',
      { session: session.body.id, type: 'skip', issued_by: friend.body.id });
    const upload = await api(token, 'POST', '/api/collections/uploads/records',
      { uploader: friend.body.id, title: 'Demo', filename: 'x4.mp3' });
    check('the member queued, skipped and uploaded',
      [host, friend, track, session, queued, skipped, upload].every((r) => r.ok),
      [host, friend, track, session, queued, skipped, upload].map((r) => r.status).join(','));

    const del = await api(token, 'DELETE', `/api/collections/users/records/${friend.body.id}`);
    check('deleting that member succeeds', del.ok, `${del.status} ${JSON.stringify(del.body)}`);

    const row = await api(token, 'GET', `/api/collections/session_tracks/records/${queued.body.id}`);
    check('the queued song stays in the carlist, naming nobody', row.ok && row.body.added_by === '', JSON.stringify(row.body));
    const song = await api(token, 'GET', `/api/collections/uploads/records/${upload.body.id}`);
    check('the uploaded song stays for the playlists that hold it', song.ok && song.body.uploader === '', JSON.stringify(song.body));
  });
} finally {
  rmSync(WORK, { recursive: true, force: true });
}

const failed = out.filter((c) => !c.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
process.exit(failed.length ? 1 : 0);
