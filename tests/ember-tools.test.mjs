/** The decisions behind the npm run tools (scripts/ember/logic.mjs).
 *
 *      node tests/ember-tools.test.mjs      # or: npm run test:ember-tools */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  branchNameProblem,
  draftNotes,
  hostVerdict,
  isDigest,
  isLivePbData,
  messageHeadline,
  messageLine,
  pickFreePort,
  plainVersion,
  sandboxPortProblem,
  scanAddedLines,
  tidyPlan,
  worktreeFolder,
} from '../scripts/ember/logic.mjs';
import {
  addBugReport,
  autoSummary,
  bodyHash,
  fingerprint,
  needsPost,
  plistText,
  snowflake,
  syncMessages,
  emptyState,
  isNoise,
  markSeen,
  messageText,
  newMessages,
  normalizeState,
  parseTarget,
  renderTracker,
  splitMessages,
  stampRelease,
  upsertItem,
} from '../scripts/ember/trackerLogic.mjs';
import { notesProblems, parseNotes } from '../scripts/release/releaseLib.mjs';

test('sandbox: never the live app or live PocketBase port', () => {
  assert.match(sandboxPortProblem(3000), /live/);
  assert.match(sandboxPortProblem(8090), /live/);
  assert.equal(sandboxPortProblem(3072), null);
  assert.ok(sandboxPortProblem(80));
  assert.equal(pickFreePort([3050, 3051, 3072]), 3052);
  assert.equal(pickFreePort([]), 3050);
});

test('sandbox: the live pb_data is recognised, with or without a slash', () => {
  assert.ok(isLivePbData('/x/spotify-clone/pocketbase/pb_data/', '/x/spotify-clone'));
  assert.ok(!isLivePbData('/x/spotify-clone-wt/_sandbox/pb_data', '/x/spotify-clone'));
});

test('branch: names in the house style, folders from the last part', () => {
  assert.equal(branchNameProblem('fix/search-crash'), null);
  assert.equal(branchNameProblem('release-0.7.31'), null);
  assert.ok(branchNameProblem('Fix Search'));
  assert.ok(branchNameProblem('main'));
  assert.ok(branchNameProblem(''));
  assert.equal(worktreeFolder('fix/reported-1022'), 'reported-1022');
  assert.throws(() => worktreeFolder('fix/..'));
});

test('notes-draft: fixes and features become bullets the release accepts', () => {
  const text = draftNotes('feat/add-to-queue', [
    'feat(web): add to queue from a song menu',
    'fix: queue keeps order',
    'chore(release): web 0.7.31',
    'test: more checks',
    "Merge branch 'x'",
  ]);
  const notes = parseNotes(text);
  assert.equal(notes.id, 'add-to-queue');
  assert.equal(notes.title, 'Add to queue');
  assert.deepEqual(notes.bullets, ['Add to queue from a song menu.', 'Queue keeps order.']);
  assert.deepEqual(notesProblems(notes, []), []);
});

test('pre-push: secrets, em dashes and pranks in What\'s new are caught', () => {
  const diff = [
    '+++ b/apps/web/lib/x.ts',
    // Put together here so no whole webhook URL sits in the repo.
    `+const hook = "https://discord.com/api/${'web'}hooks/123456789/abcdefghijklmnopqrstuvwxyz0123";`,
    '+POCKETBASE_ADMIN_PASSWORD=hunter2hunter2',
    '+const ok = process.env.POCKETBASE_ADMIN_PASSWORD;',
    '+// a dash \u2014 here',
    '+++ b/apps/web/lib/changelog.ts',
    "+      'A new prank button.',",
    '+++ b/apps/web/lib/x.test.ts',
    '+POCKETBASE_ADMIN_PASSWORD=fake-for-the-test',
  ].join('\n');
  const problems = scanAddedLines(diff);
  assert.ok(problems.includes('apps/web/lib/x.ts: looks like a Discord webhook URL'));
  assert.ok(problems.includes('apps/web/lib/x.ts: looks like a password in a setting'));
  assert.ok(problems.includes('apps/web/lib/x.ts: em dash'));
  assert.ok(problems.includes("apps/web/lib/changelog.ts: mentions pranks in What's new"));
  assert.ok(!problems.some((p) => p.startsWith('apps/web/lib/x.test.ts')));
  assert.deepEqual(scanAddedLines('+++ b/README.md\n+Run npm run sandbox.\n'), []);
});

test('tidy-branches: only merged branches, never main, never unsaved work', () => {
  const plan = tidyPlan(
    {
      main: { merged: true },
      'fix/a': { merged: true, worktree: '/wt/a' },
      'fix/b': { merged: true, worktree: '/wt/b', dirty: true },
      'feat/c': { merged: false, worktree: '/wt/c' },
      'fix/here': { merged: true },
    },
    'fix/here',
  );
  assert.deepEqual(plan.remove, [{ name: 'fix/a', worktree: '/wt/a' }]);
  assert.deepEqual(plan.keep, [{ name: 'fix/b', why: 'has uncommitted changes' }]);
});

test('host-check: says when ./update.sh is due', () => {
  assert.equal(plainVersion('0.7.30 (9081feae 2026-10-15)'), '0.7.30');
  assert.equal(hostVerdict('0.7.30 (x)', '0.7.31').due, true);
  assert.equal(hostVerdict('0.7.31 (x)', '0.7.31').due, false);
  assert.equal(hostVerdict('0.8.0', '0.7.31').due, false);
  assert.equal(hostVerdict(null, '0.7.31').due, true);
});

test('reports: webhook embeds are read, digests are recognised', () => {
  const report = {
    timestamp: '2026-10-22T13:59:00Z',
    author: { username: 'Bug Report' },
    content: '',
    embeds: [{ title: 'Bug report from a@b.c', description: 'Playlists jump\nto the top', fields: [{ name: 'Where', value: 'tauri 0.7.30' }] }],
    attachments: [{ filename: 'report.json' }],
  };
  assert.match(messageLine(report), /^- 2026-10-22T13:59 Bug Report: Bug report from a@b\.c :: Playlists jump \/ to the top \| Where: tauri 0\.7\.30 \[files: report\.json\]$/);
  assert.equal(messageHeadline(report), 'Bug report from a@b.c Playlists jump to the top');
  assert.ok(isDigest({ embeds: [{ title: 'Daily error digest 2026-10-22' }] }));
  assert.ok(!isDigest(report));
});

test('tracker: links and bare ids are parsed', () => {
  assert.deepEqual(parseTarget('https://discord.com/channels/11/22222222222222222/33333333333333333'), {
    guild: '11',
    channelId: '22222222222222222',
    id: '33333333333333333',
  });
  assert.deepEqual(parseTarget('<https://discord.com/channels/11/22/33333333333333333>')?.id, '33333333333333333');
  assert.deepEqual(parseTarget('1234567890123456789'), { id: '1234567890123456789' });
  assert.equal(parseTarget('hello'), null);
  assert.equal(parseTarget('123'), null);
});

test('tracker: digests and release posts are noise, webhook bug reports are not', () => {
  const bot = { bot: true };
  assert.ok(isNoise({ author: bot, content: '**Daily error digest** 2026-10-22' }));
  assert.ok(isNoise({ author: bot, content: '', embeds: [{ title: 'Daily error digest 2026-10-22' }] }));
  assert.ok(isNoise({ author: bot, content: "What's new in Ember 0.7.31" }));
  assert.ok(isNoise({ author: bot, content: 'Release notes 0.7.31' }));
  assert.ok(!isNoise({ author: bot, content: '', embeds: [{ title: 'Bug report from a@b.c', description: 'Playlists jump' }] }));
  assert.ok(!isNoise({ author: { bot: false }, content: 'Daily digest idea: send me one every morning with the new songs in it' }));
  // Short messages by people are chat.
  assert.ok(isNoise({ author: { bot: false }, content: 'easy peasy' }));
  assert.ok(!isNoise({ author: { bot: false }, webhook_id: '9', content: '', embeds: [{ title: 'New feature: Queue', description: '.' }] }));
  assert.equal(messageText({ content: '', embeds: [{ title: 'Bug report', description: 'Playlists\njump' }] }), 'Bug report Playlists jump');
});

test('tracker: a scan skips tracked, seen and noise', () => {
  const state = markSeen(upsertItem(emptyState(), { id: '1', status: 'fixed', summary: 'a', link: 'l', at: 'x' }), ['2']);
  const msgs = [{ id: '1' }, { id: '2' }, { id: '3', author: { bot: true }, content: 'Daily digest' }, { id: '4', content: 'Playlists jump to the top of the sidebar when you click one of them' }, { id: '5', content: 'hi' }];
  assert.deepEqual(newMessages(msgs, state).map((m) => m.id), ['4']);
});

test('tracker: sections in order, empty ones left out, newest first', () => {
  const link = (n) => `https://discord.com/channels/1/2/${n}`;
  let s = emptyState();
  s = upsertItem(s, { id: '1', status: 'rejected', summary: 'Dark mode', reason: 'already there', link: link(1), at: '2026-10-01T00:00:00Z' });
  s = upsertItem(s, { id: '2', status: 'fixed', summary: 'Old fix', version: '0.7.1', link: link(2), at: '2026-10-02T00:00:00Z' });
  s = upsertItem(s, { id: '3', status: 'fixed', summary: 'New fix', link: link(3), at: '2026-10-03T00:00:00Z' });
  s = upsertItem(s, { id: '4', status: 'open', summary: 'Sleep timer', link: link(4), at: '2026-10-04T00:00:00Z' });
  const out = renderTracker(s, new Date(2026, 9, 23, 9, 5)).split('\n');
  assert.equal(out[0], '**Ember tracker** (updated 2026-10-23 09:05)');
  assert.deepEqual(out.slice(1), [
    '',
    '**✅ Fixed**',
    `- New fix (not released yet) [open](<${link(3)}>)`,
    `- Old fix (0.7.1) [open](<${link(2)}>)`,
    '',
    '**🔨 Accepted, not done yet**',
    `- Sleep timer [open](<${link(4)}>)`,
    '',
    '**❌ Rejected**',
    `- Dark mode: already there [open](<${link(1)}>)`,
  ]);
  assert.ok(!out.includes('**✅ Made**'));
});

test('tracker: long lists split between lines under 2000 characters', () => {
  let s = emptyState();
  for (let i = 0; i < 80; i++) s = upsertItem(s, { id: String(i), status: 'fixed', summary: `Fix number ${i} ${'word '.repeat(12)}`, link: `https://discord.com/channels/1/2/${i}`, at: `2026-10-${10 + (i % 10)}` });
  const text = renderTracker(s);
  const chunks = splitMessages(text);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.length <= 2000));
  assert.equal(chunks.join('\n').replace(/\n+/g, '\n'), text.replace(/\n+/g, '\n'));
  assert.ok(chunks.every((c) => c.split('\n').every((l) => l === '' || /^(\*\*|- )/.test(l))));
  assert.ok(splitMessages('x'.repeat(2500))[0].length <= 2000);
});

test('tracker: release stamps only fixed and made items without a version', () => {
  let s = emptyState();
  s = upsertItem(s, { id: '1', status: 'fixed', summary: 'a', link: 'l', at: '1' });
  s = upsertItem(s, { id: '2', status: 'made', summary: 'b', version: '0.7.0', link: 'l', at: '2' });
  s = upsertItem(s, { id: '3', status: 'open', summary: 'c', link: 'l', at: '3' });
  const { state, count } = stampRelease(s, '0.7.31');
  assert.equal(count, 1);
  assert.deepEqual(state.items.map((i) => i.version), ['0.7.31', '0.7.0', undefined]);
});

test('tracker: upsert updates by id, moves open to fixed and clears stale reason', () => {
  let s = upsertItem(emptyState(), { id: '1', status: 'open', summary: 'a', link: 'l', at: '1' });
  s = upsertItem(s, { id: '1', status: 'rejected', reason: 'no' });
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].reason, 'no');
  assert.equal(s.items[0].link, 'l');
  s = upsertItem(s, { id: '1', status: 'fixed' });
  assert.equal(s.items[0].status, 'fixed');
  assert.equal(s.items[0].reason, undefined);
  assert.equal(s.items[0].summary, 'a');
  assert.deepEqual(normalizeState(null), emptyState());
});

const GUILD = { id: '1', channels: { 'bug-reports': '2' } };
let nextId = 1000000000000000000n;
const bug = (desc, minute = 0, user = 'Bug Report') => ({
  id: String((nextId += 1n)),
  timestamp: new Date(Date.UTC(2026, 9, 23, 10, minute)).toISOString(),
  author: { username: user, bot: true },
  content: '',
  embeds: [{ title: 'Bug report from a@b.c', description: desc }],
});

test('tracker: fingerprint ignores numbers, ids, urls, quotes and spacing', () => {
  const a = fingerprint('Playlist  "Road 12" jumps at 3:45 https://x.y/z?id=9 id deadbeef12');
  const b = fingerprint("playlist Road 7 jumps at 10:02 http://other.io/a id cafe9988ab");
  assert.equal(a, b);
  assert.notEqual(fingerprint('Search crashes'), fingerprint('Queue crashes'));
  assert.equal(fingerprint('decade'), 'decade');
});

test('tracker: the same bug bumps one group instead of adding lines', () => {
  let s = emptyState();
  for (let i = 0; i < 12; i++) s = addBugReport(s, bug(`Playlists jump to the top (${i})`, i), GUILD);
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].count, 12);
  assert.match(renderTracker(s), /\*\*🐞 Bugs, not fixed yet\*\*\n- Playlists jump to the top \(0\) x12 \[open\]/);
  assert.equal(autoSummary(bug('x'.repeat(300))).length, 100);
});

test('tracker: more than 5 new groups from one author in an hour are folded', () => {
  let s = emptyState();
  for (let i = 0; i < 9; i++) s = addBugReport(s, bug(`Distinct problem ${'abcdefghi'[i]}x${'q'.repeat(i)}`, i), GUILD);
  s = addBugReport(s, bug('Other author problem', 10, 'Someone Else'), GUILD);
  assert.equal(s.items.filter((i) => !i.held).length, 6);
  const held = s.items.find((i) => i.held);
  assert.equal(held.count, 4);
  assert.match(renderTracker(s), /- 4 more reports from Bug Report \(held\)/);
});

test('tracker: a bug that comes back after a fix is a new group with a note', () => {
  let s = addBugReport(emptyState(), bug('Queue loses songs'), GUILD);
  s = upsertItem(s, { id: s.items[0].id, status: 'fixed', version: '0.7.30' });
  s = addBugReport(s, bug('Queue loses songs', 5), GUILD);
  assert.equal(s.items.length, 2);
  assert.equal(s.items[0].status, 'fixed');
  assert.equal(s.items[1].cameBack, '0.7.30');
  assert.match(renderTracker(s), /Queue loses songs \(came back after fix in 0\.7\.30\) \[open\]/);
  s = addBugReport(s, bug('Queue loses songs', 6), GUILD);
  assert.equal(s.items[1].count, 2);
});

test('tracker: the new-bugs section is capped at 15 lines', () => {
  let s = emptyState();
  for (let i = 0; i < 20; i++) {
    s = { ...s, items: [...s.items, { id: String(i), channel: 'bug-reports', status: 'new', summary: `bug ${i}`, link: 'l', count: 1, at: `2026-10-${10 + i}`, lastAt: `2026-10-${10 + i}` }] };
  }
  const out = renderTracker(s).split('\n');
  assert.equal(out.filter((l) => l.startsWith('- bug')).length, 15);
  assert.ok(out.includes('- and 5 more'));
});

test('tracker: sections order is bugs, requests, fixed, made, open, rejected', () => {
  let s = emptyState();
  const base = { link: 'l', at: '2026-10-01' };
  s = upsertItem(s, { ...base, id: '1', channel: 'bug-reports', status: 'new', summary: 'b', count: 1 });
  s = upsertItem(s, { ...base, id: '2', channel: 'ideas', status: 'new', summary: 'r' });
  s = upsertItem(s, { ...base, id: '3', channel: 'x', status: 'fixed', summary: 'f' });
  s = upsertItem(s, { ...base, id: '4', channel: 'x', status: 'made', summary: 'm' });
  s = upsertItem(s, { ...base, id: '5', channel: 'x', status: 'open', summary: 'o' });
  s = upsertItem(s, { ...base, id: '6', channel: 'x', status: 'rejected', summary: 'j' });
  const heads = renderTracker(s).split('\n').filter((l) => l.startsWith('**') && !l.includes('tracker'));
  assert.deepEqual(heads, ['**🐞 Bugs, not fixed yet**', '**🆕 New requests, not sorted**', '**✅ Fixed**', '**✅ Made**', '**🔨 Accepted, not done yet**', '**❌ Rejected**']);
});

test('tracker: seen takes an item off the list', () => {
  const state = upsertItem(emptyState(), { id: '7', status: 'new', summary: 'easy', link: 'l', at: 'x' });
  assert.deepEqual(markSeen(state, ['7']).items, []);
});

test('tracker: request forms are summed up by their title', () => {
  assert.equal(autoSummary({ content: '', embeds: [{ title: 'New feature: Option to queue a song', description: '.' }] }), 'Option to queue a song');
  assert.equal(autoSummary({ content: '', embeds: [{ title: 'Fix: lyrics display tweak', description: 'let users scroll' }] }), 'lyrics display tweak: let users scroll');
});

test('tracker: sync only reads after lastId, dedupes, and skips noise', async () => {
  const channels = { 'bug-reports': '2', ideas: '3' };
  const t0 = Date.parse('2026-10-23T10:00:00Z');
  const store = { 2: [], 3: [] };
  const calls = [];
  const fetchPage = async (id, after) => {
    calls.push([id, after]);
    return store[id].filter((m) => BigInt(m.id) > BigInt(after));
  };
  const idea = (text, id) => ({ id: String(id), timestamp: '2026-10-23T10:05:00Z', author: { username: 'o' }, content: text });
  // First run only sets the starting point.
  let r = await syncMessages(emptyState(), { channels, fetchPage, guildId: '1', now: t0 });
  assert.equal(r.state.items.length, 0);
  assert.equal(r.state.lastId['3'], snowflake(t0));
  const big = BigInt(snowflake(t0)) + 5000000000000n;
  store[3].push(idea('Add a sleep timer that stops playback after a set time\nmore detail', big), idea('Daily digest', big + 1n));
  store[3][1].author.bot = true;
  store[2].push({ ...bug('Search crashes'), id: String(big + 2n) }, { ...bug('Search crashes'), id: String(big + 3n) });
  r = await syncMessages(r.state, { channels, fetchPage, guildId: '1', now: t0 });
  assert.deepEqual(r.state.items.map((i) => [i.channel, i.status, i.summary, i.count ?? 1]), [
    ['bug-reports', 'new', 'Search crashes', 2],
    ['ideas', 'new', 'Add a sleep timer that stops playback after a set time', 1],
  ]);
  assert.equal(r.state.lastId['3'], String(big + 1n));
  calls.length = 0;
  const again = await syncMessages(r.state, { channels, fetchPage, guildId: '1', now: t0 });
  assert.equal(again.state.items.length, 2);
  assert.ok(calls.every(([id, after]) => after === r.state.lastId[id]));
});

test('tracker: an unchanged list is not posted again, the clock line is ignored', () => {
  const s = upsertItem(emptyState(), { id: '1', channel: 'ideas', status: 'new', summary: 'a', link: 'l', at: '1' });
  const t1 = renderTracker(s, new Date(2026, 9, 23, 9, 0));
  assert.ok(needsPost(s, t1));
  const posted = { ...s, postedHash: bodyHash(t1) };
  assert.ok(!needsPost(posted, renderTracker(s, new Date(2026, 9, 23, 9, 30))));
  const changed = upsertItem(posted, { id: '2', channel: 'ideas', status: 'new', summary: 'b', link: 'l', at: '2' });
  assert.ok(needsPost(changed, renderTracker(changed)));
});

test('tracker: the launchd agent runs sync every 300 seconds', () => {
  const p = plistText({ label: 'com.ember.tracker', node: '/n/node', script: '/m/tracker.mjs', log: '/l.log', interval: 300 });
  assert.match(p, /<integer>300<\/integer>/);
  assert.match(p, /<string>\/m\/tracker\.mjs<\/string>\s*<string>sync<\/string>/);
});
