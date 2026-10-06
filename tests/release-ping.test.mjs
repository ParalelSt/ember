import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localParts, decide, buildMessage, extraNotes, run,
} from '../.github/scripts/release-ping.mjs';

const U = '123456789';
const at = (iso) => new Date(iso);

test('DST: winter and summer convert to Zagreb time', () => {
  assert.deepEqual(localParts(at('2026-01-15T18:00:00Z')), { date: '2026-01-15', hour: 19 });
  assert.deepEqual(localParts(at('2026-07-15T17:00:00Z')), { date: '2026-07-15', hour: 19 });
  assert.equal(localParts(at('2026-07-15T18:00:00Z')).hour, 20);
  assert.equal(localParts(at('2026-01-15T17:00:00Z')).hour, 18);
  assert.equal(localParts(at('2026-07-15T22:30:00Z')).date, '2026-07-16');
});

test('decide: before 19:00 no ping', () => {
  assert.equal(decide({ now: at('2026-10-06T16:59:00Z'), head: 'b', tag: { commit: 'a', date: '2026-10-05' } }).ping, false);
});
test('decide: 19:05 with new commits pings', () => {
  assert.equal(decide({ now: at('2026-10-06T17:05:00Z'), head: 'b', tag: { commit: 'a', date: '2026-10-05' } }).ping, true);
});
test('decide: no tag pings', () => {
  assert.equal(decide({ now: at('2026-10-06T17:05:00Z'), head: 'b', tag: null }).ping, true);
});
test('decide: same evening no second ping, next day pings', () => {
  const tag = { commit: 'a', date: '2026-10-06' };
  assert.equal(decide({ now: at('2026-10-06T18:30:00Z'), head: 'b', tag }).ping, false);
  assert.equal(decide({ now: at('2026-10-07T17:00:00Z'), head: 'b', tag }).ping, true);
});
test('decide: tag at HEAD no ping', () => {
  assert.equal(decide({ now: at('2026-10-07T17:00:00Z'), head: 'a', tag: { commit: 'a', date: '2026-10-01' } }).ping, false);
});

const NOTES = `# 0.7.20: x (apps 0.4.15)

**Host: run \`./update.sh\` as usual (no new packages).** Invite links.

# 0.7.19: y

**Host: run \`./update.sh\`, then add \`NEW_VAR=1\` to apps/web/.env.local.** More.
`;

test('notes extra only when more than update.sh', () => {
  assert.deepEqual(extraNotes(NOTES, '0.7.19'), []);
  assert.equal(extraNotes(NOTES, '0.7.18').length, 1);
  assert.match(extraNotes(NOTES, '0.7.18')[0], /NEW_VAR/);
});

test('message: update.sh line, no apps line without a tag, whats new', () => {
  const m = buildMessage({ userId: U, webVersion: '0.7.20', appsVersion: '0.4.14', changedPaths: ['apps/web/x.ts'] });
  assert.match(m, /^<@123456789> New version available: web 0\.7\.20 \(apps 0\.4\.14\)/);
  assert.match(m, /Pull and run \.\/update\.sh/);
  assert.doesNotMatch(m, /New apps/);
  assert.doesNotMatch(m, /What's new/);
});
test('message: no update.sh line for docs only; never an apps line', () => {
  const m = buildMessage({ userId: U, webVersion: '0.7.20', changedPaths: ['docs/a.md'] });
  assert.doesNotMatch(m, /update\.sh/);
  assert.doesNotMatch(m, /New apps|What's new/);
});
test('message: never prank, short', () => {
  const m = buildMessage({
    userId: U, webVersion: '1', changedPaths: ['scripts/a'],
    notesExtra: ['Prank mode needs X', 'a', 'b', 'c'],
  });
  assert.doesNotMatch(m, /prank/i);
  assert.ok(m.split('\n').length <= 6);
});

// Flow with fake git and fetch.
function fakeEnv({ tag = null, head = 'h2' } = {}) {
  const state = { tag, posts: [], pushed: 0 };
  const git = (...a) => {
    const j = a.join(' ');
    if (j === 'rev-parse HEAD') return head;
    if (j.startsWith('rev-parse --verify')) { if (!state.tag) throw new Error('no'); return state.tag.commit; }
    if (j.startsWith('tag -l --format')) return state.tag.date;
    if (j === 'rev-parse HEAD~1') return 'h1';
    if (a[0] === 'diff') return state.diff ?? 'apps/web/a.ts';
    if (a[0] === 'show' && a[1].endsWith('package.json')) return JSON.stringify({ version: '0.7.20' });
    if (a[0] === 'show') return NOTES;
    if (a[0] === 'tag' && a[1] === '--merged') return '';
    if (a[0] === 'tag' && a[1] === '-f') { state.tag = { commit: a[a.indexOf('-m') + 2], date: a[a.indexOf('-m') + 1] }; return ''; }
    if (a[0] === 'push') { state.pushed++; return ''; }
    throw new Error('unexpected git ' + j);
  };
  const fetch = async (u, o) => { state.posts.push(JSON.parse(o.body)); return { ok: state.ok !== false, status: state.ok === false ? 500 : 204 }; };
  const env = { DISCORD_RELEASE_WEBHOOK: 'http://hook', DISCORD_NOTIFY_USER_ID: U };
  return { state, deps: { git, fetch, env, log: () => {} } };
}

test('run: pings once per evening, again next evening', async () => {
  const f = fakeEnv({ tag: { commit: 'h1', date: '2026-10-05' } });
  const r1 = await run({ ...f.deps, now: at('2026-10-06T17:05:00Z') });
  assert.equal(r1.pinged, true);
  assert.deepEqual(f.state.posts[0].allowed_mentions, { users: [U] });
  assert.equal(f.state.tag.date, '2026-10-06');
  assert.equal(f.state.pushed, 1);
  // new commit same evening
  f.deps.git = fakeEnv({ tag: f.state.tag, head: 'h3' }).deps.git;
  assert.equal((await run({ ...f.deps, now: at('2026-10-06T18:10:00Z') })).pinged, false);
  assert.equal(f.state.posts.length, 1);
});
test('run: missing env does not ping or move tag; failed POST throws without moving', async () => {
  const f = fakeEnv({ tag: { commit: 'h1', date: '2026-10-05' } });
  const r = await run({ ...f.deps, env: {}, now: at('2026-10-06T17:05:00Z') });
  assert.equal(r.pinged, false);
  assert.equal(f.state.tag.commit, 'h1');
  f.state.ok = false;
  await assert.rejects(run({ ...f.deps, now: at('2026-10-06T17:05:00Z') }));
  assert.equal(f.state.tag.commit, 'h1');
});
test('run: before 19:00 does nothing', async () => {
  const f = fakeEnv({ tag: { commit: 'h1', date: '2026-10-05' } });
  assert.equal((await run({ ...f.deps, now: at('2026-10-06T10:00:00Z') })).pinged, false);
  assert.equal(f.state.posts.length, 0);
});

test('run: a change the host does not run (CI, docs) does not ping or move the tag', async () => {
  const f = fakeEnv({ tag: { commit: 'h1', date: '2026-10-05' } });
  f.state.diff = '.github/workflows/release-ping.yml\nREADME.md';
  const r = await run({ ...f.deps, now: at('2026-10-06T17:05:00Z') });
  assert.equal(r.pinged, false);
  assert.equal(f.state.posts.length, 0);
  assert.equal(f.state.tag.commit, 'h1');
});
