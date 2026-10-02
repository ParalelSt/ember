/** The 50-member cap on a collaborative playlist holds even when several
 *  people join at once (pb_hooks/ensure_collab_playlists.pb.js, the
 *  before-create hook on playlist_members).
 *
 *      node tests/collab-member-cap.test.mjs     # or: npm run test:collab-member-cap
 *
 *  Boots its own throwaway PocketBase (PB_BIN, default ./pocketbase/pocketbase,
 *  port PB_PORT, default 8248) on a fresh temp dir: migrate up with an empty
 *  hooks dir first, then serve with this checkout's hooks and --automigrate=0.
 *  Stops it at the end. Never touches any real pb_data. */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const BIN = process.env.PB_BIN ?? join(ROOT, 'pocketbase/pocketbase');
const PORT = process.env.PB_PORT ?? '8248';
const PB = `http://127.0.0.1:${PORT}`;
const SU = 'su@sandbox.test';
const SU_PW = 'SandboxSu-2026-xyz';
const MAX = 50;

const dir = mkdtempSync(join(tmpdir(), 'ember-cap-'));
mkdirSync(join(dir, 'empty'));
const common = ['--dir', join(dir, 'data'), '--migrationsDir', join(ROOT, 'pocketbase/pb_migrations')];
let server;
const results = [];
const check = (name, pass, detail = '') => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const stop = () => {
  if (server && !server.killed) server.kill('SIGTERM');
  rmSync(dir, { recursive: true, force: true });
};

async function api(method, path, token, body) {
  const r = await fetch(PB + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}

try {
  let r = spawnSync(BIN, ['migrate', 'up', ...common, '--hooksDir', join(dir, 'empty')], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`migrate failed: ${r.stderr || r.stdout}`);
  r = spawnSync(BIN, ['admin', 'create', SU, SU_PW, '--dir', join(dir, 'data')], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`admin create failed: ${r.stderr || r.stdout}`);
  server = spawn(BIN, ['serve', '--http', `127.0.0.1:${PORT}`, ...common, '--hooksDir', join(ROOT, 'pocketbase/pb_hooks'), '--automigrate=0'], {
    stdio: process.env.PB_LOG ? 'inherit' : 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    if ((await fetch(`${PB}/api/health`).catch(() => null))?.ok) break;
    await new Promise((res) => setTimeout(res, 100));
  }
  const su = (await api('POST', '/api/admins/auth-with-password', null, { identity: SU, password: SU_PW })).data?.token;
  if (!su) throw new Error('superuser sign-in failed');

  const stamp = Date.now().toString(36);
  const users = [];
  for (let i = 0; i < MAX + 6; i++) {
    const u = await api('POST', '/api/collections/users/records', su, {
      email: `u${i}-${stamp}@ember.test`, password: 'CapTest2026!!', passwordConfirm: 'CapTest2026!!', name: `U${i}`, verified: true,
    });
    if (u.status !== 200) throw new Error(`user ${i}: ${JSON.stringify(u.data)}`);
    users.push(u.data.id);
  }
  const pl = await api('POST', '/api/collections/playlists/records', su, { user: users[0], name: 'Cap', collaborative: true });
  if (pl.status !== 200) throw new Error(`playlist: ${JSON.stringify(pl.data)}`);
  const joinAs = (u) => api('POST', '/api/collections/playlist_members/records', su, { playlist: pl.data.id, user: u });
  const count = async () =>
    (await api('GET', `/api/collections/playlist_members/records?perPage=1&filter=${encodeURIComponent(`playlist="${pl.data.id}"`)}`, su)).data.totalItems;

  // 48 sequentially, leaving two free places; then six at once.
  for (let i = 1; i <= MAX - 2; i++) await joinAs(users[i]);
  check('fills to 48 sequentially', (await count()) === MAX - 2, String(await count()));
  const burst = await Promise.all(users.slice(MAX - 1, MAX + 5).map(joinAs));
  const ok = burst.filter((x) => x.status === 200).length;
  const refused = burst.filter((x) => x.status === 400).length;
  const total = await count();
  check('six at once into two places: exactly two get in', ok === 2 && refused === 4, `ok=${ok} refused=${refused}`);
  check('the list never passes 50', total === MAX, String(total));
  const over = await joinAs(users[MAX + 5]);
  check('one more is refused (400)', over.status === 400 && (await count()) === MAX, String(over.status));
  const other = await api('POST', '/api/collections/playlists/records', su, { user: users[1], name: 'Other', collaborative: true });
  const okOther = await api('POST', '/api/collections/playlist_members/records', su, { playlist: other.data.id, user: users[2] });
  check('a different playlist is not affected', okOther.status === 200, String(okOther.status));
} catch (e) {
  check('ran without error', false, String(e?.message ?? e));
} finally {
  stop();
}
const bad = results.filter((p) => !p).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
