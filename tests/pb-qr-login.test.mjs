/** QR sign-in, the PocketBase side: the login_requests collection and the
 *  two superuser-only hook routes (pb_hooks/ensure_login_requests.pb.js,
 *  pb_hooks/qr_login.pb.js).
 *
 *      PB_BIN=/path/to/pocketbase node tests/pb-qr-login.test.mjs
 *
 *  Boots its own throwaway PocketBase (this checkout's hooks and migrations,
 *  a temp data dir) on PB_PORT (default 8180), never the sandbox or live
 *  data. The superuser and the member are made up for the test.
 *
 *    - login_requests exists with every rule null (server-only) and the
 *      unique code / token_hash indexes plus the user index
 *    - POST /api/ember/qr-login/mint { request }: 401 without auth, 401 with
 *      a member's token (even an is_admin member), 404 for an unknown
 *      request, 409 unless the request is approved and unexpired. It claims
 *      the request (approved -> used) and mints in one transaction, so of
 *      several concurrent mints for one request exactly one succeeds. The
 *      token passes authRefresh as the approver, and the record has the
 *      same keys authWithPassword gives
 *    - POST /api/ember/qr-login/revoke-all: same guards; afterwards every
 *      token of that user (minted or password) is refused, and a request
 *      they approved that no device has collected yet can no longer be
 *      minted
 *    - the sweep flips a pending row past its expiry to expired */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PB_BIN = process.env.PB_BIN ?? join(ROOT, 'pocketbase', 'pocketbase');
const PORT = process.env.PB_PORT ?? '8180';
const PB = `http://127.0.0.1:${PORT}`;
const HOOKS = join(ROOT, 'pocketbase', 'pb_hooks');
const MIGRATIONS = join(ROOT, 'pocketbase', 'pb_migrations');
if (!existsSync(PB_BIN)) {
  console.error(`No PocketBase binary at ${PB_BIN}; set PB_BIN.`);
  process.exit(2);
}
if (await fetch(`${PB}/api/health`).then(() => true, () => false)) {
  console.error(`Something is already listening on ${PB}; pick another PB_PORT.`);
  process.exit(2);
}

const WORK = mkdtempSync(join(tmpdir(), 'ember-qr-pb-'));
const EMPTY_HOOKS = join(WORK, 'empty-hooks');
mkdirSync(EMPTY_HOOKS);
const SU_EMAIL = 'qr-su@qr.test';
const SU_PASSWORD = 'Qr-Superuser-Test-2026';
const MEMBER_PASSWORD = 'Qr-Member-Test-2026';

const out = [];
const check = (name, pass, detail = '') => {
  out.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const CRED_VARS = ['EMBER_PB_SUPERUSER_EMAIL', 'EMBER_PB_SUPERUSER_PASSWORD', 'EMBER_ADMIN_EMAIL', 'EMBER_ADMIN_PASSWORD'];
function env() {
  const e = { ...process.env };
  for (const k of CRED_VARS) delete e[k];
  return { ...e, EMBER_PB_SUPERUSER_EMAIL: SU_EMAIL, EMBER_PB_SUPERUSER_PASSWORD: SU_PASSWORD };
}

const DIR = join(WORK, 'data');
{
  const r = spawnSync(PB_BIN, ['migrate', 'up', `--dir=${DIR}`, `--migrationsDir=${MIGRATIONS}`, `--hooksDir=${EMPTY_HOOKS}`],
    { encoding: 'utf8', env: env() });
  if (r.status !== 0) throw new Error(`migrate up failed: ${r.stderr || r.stdout}`);
}

async function boot(during) {
  for (let i = 0; i < 50 && (await fetch(`${PB}/api/health`).then(() => true, () => false)); i++) {
    await new Promise((r) => setTimeout(r, 200));
  }
  const child = spawn(PB_BIN, ['serve', `--http=127.0.0.1:${PORT}`, `--dir=${DIR}`, `--hooksDir=${HOOKS}`,
    `--migrationsDir=${MIGRATIONS}`, '--automigrate=0'], { env: env() });
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

const json = (method, path, { token, body } = {}) =>
  fetch(PB + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

let rowId = null;
try {
  await boot(async () => {
    const su = (await json('POST', '/api/admins/auth-with-password', { body: { identity: SU_EMAIL, password: SU_PASSWORD } })).body?.token;
    if (!su) throw new Error('could not sign in as the test superuser');

    // ── The collection ──
    const col = await json('GET', '/api/collections/login_requests', { token: su });
    check('Q1 login_requests exists', col.status === 200, `status ${col.status}`);
    const c = col.body ?? {};
    check('Q1b every rule is null (server-only)',
      ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule'].every((k) => c[k] === null),
      JSON.stringify([c.listRule, c.viewRule, c.createRule, c.updateRule, c.deleteRule]));
    const idx = (c.indexes ?? []).join('\n');
    check('Q1c unique index on code', /UNIQUE INDEX[^\n]*\(\s*`?code`?\s*\)/i.test(idx), idx);
    check('Q1d unique index on token_hash', /UNIQUE INDEX[^\n]*\(\s*`?token_hash`?\s*\)/i.test(idx), idx);
    check('Q1e index on user', /INDEX[^\n]*\(\s*`?user`?\s*\)/i.test(idx), idx);
    const fields = (c.schema ?? []).map((f) => f.name).sort().join(',');
    const want = ['approved_at', 'approver_ip', 'code', 'device', 'expires', 'minted_hash', 'poll_hash', 'requester_ip', 'shell', 'status', 'token_hash', 'used_at', 'user'];
    check('Q1f fields per the plan', want.every((f) => fields.split(',').includes(f)), fields);

    // ── A member, an is_admin member ──
    const mk = async (tag, isAdmin) => {
      const email = `qr-${tag}-${Date.now()}@qr.test`;
      const rec = await json('POST', '/api/collections/users/records', {
        token: su,
        body: { email, password: MEMBER_PASSWORD, passwordConfirm: MEMBER_PASSWORD, name: `QR ${tag}`, verified: true, is_admin: isAdmin },
      });
      if (rec.status !== 200) throw new Error(`could not create ${tag}: ${JSON.stringify(rec.body)}`);
      const auth = await json('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: MEMBER_PASSWORD } });
      return { id: rec.body.id, email, token: auth.body.token, authBody: auth.body };
    };
    const member = await mk('member', false);
    const owner = await mk('owner', true);

    // Members cannot reach the collection through the public API.
    const list = await json('GET', '/api/collections/login_requests/records', { token: member.token });
    const create = await json('POST', '/api/collections/login_requests/records', { token: member.token, body: { code: 'ABCDEFGH', status: 'approved', user: member.id } });
    const anonCreate = await json('POST', '/api/collections/login_requests/records', { body: { code: 'ABCDEFGH', status: 'approved' } });
    check('Q2 a member cannot list, nor anyone create, login_requests', list.status === 403 && create.status === 403 && anonCreate.status === 403,
      `${list.status} ${create.status} ${anonCreate.status}`);

    // ── mint ──
    const MINT = '/api/ember/qr-login/mint';
    let seq = 0;
    /** A login request as the Next routes would leave it. */
    const request = async (status, { user = member.id, expiresInMs = 120_000 } = {}) => {
      seq++;
      const r = await json('POST', '/api/collections/login_requests/records', {
        token: su,
        body: {
          token_hash: `th-${seq}-${Date.now()}`, poll_hash: 'ph', code: `M${String(seq).padStart(7, '0')}`, status,
          user: status === 'pending' ? '' : user, device: 'A browser on Linux', shell: 'web', requester_ip: '127.0.0.1',
          expires: new Date(Date.now() + expiresInMs).toISOString(),
        },
      });
      if (r.status !== 200) throw new Error(`could not seed a login request: ${JSON.stringify(r.body)}`);
      return r.body.id;
    };
    const rowOf = async (id) => (await json('GET', `/api/collections/login_requests/records/${id}`, { token: su })).body;

    const approvedId = await request('approved');
    const noAuth = await json('POST', MINT, { body: { request: approvedId } });
    check('Q3 mint without auth is 401', noAuth.status === 401, `status ${noAuth.status}`);
    const asMember = await json('POST', MINT, { token: member.token, body: { request: approvedId } });
    check('Q4 mint with a member token is 401', asMember.status === 401, `status ${asMember.status}`);
    const asOwner = await json('POST', MINT, { token: owner.token, body: { request: approvedId } });
    check('Q4b mint with an is_admin member token is 401 too', asOwner.status === 401, `status ${asOwner.status}`);
    const getMint = await fetch(PB + MINT, { headers: { Authorization: su } });
    check('Q4c mint is not a GET', getMint.status === 404 || getMint.status === 405, `status ${getMint.status}`);
    check('Q4d refused mints leave the request approved', (await rowOf(approvedId)).status === 'approved');
    const unknown = await json('POST', MINT, { token: su, body: { request: 'nosuchrequest12' } });
    check('Q5 mint for an unknown request is 404', unknown.status === 404, `status ${unknown.status}`);
    const blank = await json('POST', MINT, { token: su, body: { user: member.id } });
    check('Q5b mint by user (no request) is 404', blank.status === 404, `status ${blank.status}`);
    const pendingId = await request('pending');
    const pend = await json('POST', MINT, { token: su, body: { request: pendingId } });
    check('Q5c a pending request is not minted (409) and stays pending', pend.status === 409 && pend.body?.data?.status === 'pending' &&
      (await rowOf(pendingId)).status === 'pending', `status ${pend.status}`);
    for (const st of ['denied', 'expired', 'used']) {
      const id = await request(st);
      const r = await json('POST', MINT, { token: su, body: { request: id } });
      check(`Q5d a ${st} request is not minted (409)`, r.status === 409 && r.body?.data?.status === st, `status ${r.status}`);
    }
    const staleId = await request('approved', { expiresInMs: -31_000 });
    const stale = await json('POST', MINT, { token: su, body: { request: staleId } });
    check('Q5e an approved request past its expiry and the grace is 409 expired, and marked so', stale.status === 409 &&
      stale.body?.data?.status === 'expired' && (await rowOf(staleId)).status === 'expired', `status ${stale.status}`);

    const minted = await json('POST', MINT, { token: su, body: { request: approvedId } });
    check('Q6 mint with superuser auth answers { token, record } for the approver', minted.status === 200 && typeof minted.body?.token === 'string' && minted.body?.record?.id === member.id,
      `status ${minted.status}`);
    const mintKeys = Object.keys(minted.body?.record ?? {}).sort().join(',');
    const pwKeys = Object.keys(member.authBody.record ?? {}).sort().join(',');
    check('Q6b the minted record has the same keys authWithPassword gives', mintKeys === pwKeys, `mint ${mintKeys} | password ${pwKeys}`);
    check('Q6c the minted record carries the email and no secrets', minted.body?.record?.email === member.email &&
      !('tokenKey' in (minted.body?.record ?? {})) && !('passwordHash' in (minted.body?.record ?? {})));
    const after = await rowOf(approvedId);
    check('Q6e the same call claimed the request: used, used_at, and only a hash of the token', after.status === 'used' && !!after.used_at &&
      after.minted_hash === createHash('sha256').update(String(minted.body?.token)).digest('hex') && !JSON.stringify(after).includes(String(minted.body?.token)));
    const again = await json('POST', MINT, { token: su, body: { request: approvedId } });
    check('Q6f a second mint for the same request is 409 used', again.status === 409 && again.body?.data?.status === 'used', `status ${again.status}`);

    // Several Next processes polling at once: PocketBase decides, once.
    let rounds = 0;
    for (let round = 0; round < 8; round++) {
      const id = await request('approved');
      const results = await Promise.all(Array.from({ length: 6 }, () => json('POST', MINT, { token: su, body: { request: id } })));
      if (results.filter((r) => r.status === 200).length === 1 && results.filter((r) => r.status === 409).length === 5) rounds++;
    }
    check('Q12 of 6 concurrent mints for one request exactly one succeeds (8 rounds)', rounds === 8, `${rounds}/8 rounds`);

    const refreshed = await json('POST', '/api/collections/users/auth-refresh', { token: minted.body?.token });
    check('Q7 the minted token passes authRefresh as that user', refreshed.status === 200 && refreshed.body?.record?.id === member.id,
      `status ${refreshed.status}`);

    // ── revoke-all ──
    const REVOKE = '/api/ember/qr-login/revoke-all';
    const rNo = await json('POST', REVOKE, { body: { user: member.id } });
    const rMember = await json('POST', REVOKE, { token: member.token, body: { user: member.id } });
    check('Q8 revoke-all without superuser auth is 401', rNo.status === 401 && rMember.status === 401, `${rNo.status} ${rMember.status}`);
    const rUnknown = await json('POST', REVOKE, { token: su, body: { user: 'nosuchuser1234' } });
    check('Q8b revoke-all for an unknown user is 404', rUnknown.status === 404, `status ${rUnknown.status}`);
    // Still alive before the revoke.
    const stillOk = await json('POST', '/api/collections/users/auth-refresh', { token: member.token });
    const ownerBefore = await json('POST', '/api/collections/users/auth-refresh', { token: owner.token });
    // Approved on the phone, not yet collected by the new device.
    const waitingId = await request('approved');
    const othersId = await request('approved', { user: owner.id });
    const revoked = await json('POST', REVOKE, { token: su, body: { user: member.id } });
    check('Q9 revoke-all with superuser auth is ok', revoked.status === 200 && revoked.body?.ok === true && stillOk.status === 200, `status ${revoked.status}`);
    const afterMint = await json('POST', '/api/collections/users/auth-refresh', { token: minted.body?.token });
    const afterPw = await json('POST', '/api/collections/users/auth-refresh', { token: member.token });
    check('Q9b after revoke-all the minted token is refused', afterMint.status === 401, `status ${afterMint.status}`);
    check('Q9c after revoke-all the password session is refused too', afterPw.status === 401, `status ${afterPw.status}`);
    const late = await json('POST', MINT, { token: su, body: { request: waitingId } });
    check('Q9f revoke-all cancels an approved, not yet collected request: no session is minted after it', late.status === 409 &&
      (await rowOf(waitingId)).status === 'expired', `status ${late.status}`);
    check('Q9g another member\'s approved request is untouched', (await rowOf(othersId)).status === 'approved');
    const ownerAfter = await json('POST', '/api/collections/users/auth-refresh', { token: owner.token });
    check('Q9d another member is untouched', ownerBefore.status === 200 && ownerAfter.status === 200, `${ownerBefore.status} ${ownerAfter.status}`);
    const relog = await json('POST', '/api/collections/users/auth-with-password', { body: { identity: member.email, password: MEMBER_PASSWORD } });
    check('Q9e the member can still sign in with the password', relog.status === 200);

    // ── a pending row past its expiry, for the sweep on the next boot ──
    const past = new Date(Date.now() - 60_000).toISOString();
    const row = await json('POST', '/api/collections/login_requests/records', {
      token: su,
      body: { token_hash: 'sweep-test-hash', poll_hash: 'sweep-test-poll', code: 'SWEEPT00', status: 'pending', device: 'A browser on Linux', shell: 'web', requester_ip: '127.0.0.1', expires: past },
    });
    rowId = row.body?.id ?? null;
    check('Q10 the server can write a login request', row.status === 200, JSON.stringify(row.body).slice(0, 200));
  });

  await boot(async () => {
    const su = (await json('POST', '/api/admins/auth-with-password', { body: { identity: SU_EMAIL, password: SU_PASSWORD } })).body?.token;
    const row = rowId ? await json('GET', `/api/collections/login_requests/records/${rowId}`, { token: su }) : null;
    check('Q11 the sweep marks a pending row past its expiry as expired', row?.body?.status === 'expired', row?.body?.status);
  });
} finally {
  rmSync(WORK, { recursive: true, force: true });
}

const failed = out.filter((c) => !c.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
process.exit(failed.length ? 1 : 0);
